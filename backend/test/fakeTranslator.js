// Servidor falso de traducción para los tests.
//
// Igual que `fakeProviders.js` con Stripe y PayPal: se levanta un HTTP real en
// localhost y se apunta el servicio a él. Así se ejercita el mismo código que en
// producción (URL, cabeceras, form-encode, parseo de la respuesta) en lugar de
// sustituir la función `translate` por un doble, que es donde se cuelan los
// fallos de integración: un doble nunca se queja de que falte la cabecera de
// autenticación.
const http = require('http');

// Diccionario mínimo pero real, para que una traducción de prueba devuelva algo
// distinto del original y se pueda comprobar que el texto traducido es el que
// llega, no el de entrada. Las claves de idioma se guardan en minúsculas porque
// es como llegan: DeepL manda `ZH-HANS`, no `zh-Hans`.
const DICTIONARY = {
  'Hola, ¿cómo estás?': {
    en: 'Hello, how are you?',
    'zh-hans': '你好，你好吗？',
    'zh-hant': '你好，你好嗎？',
  },
  '¿Puedes llamarme mañana?': {
    en: 'Can you call me tomorrow?',
    'zh-hans': '你明天能给我打电话吗？',
  },
  '你好，你好吗？': {
    es: 'Hola, ¿cómo estás?',
    en: 'Hello, how are you?',
  },
  'Good morning': { es: 'Buenos días', 'zh-hans': '早上好' },
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Arranca el servidor falso.
 *
 * `behavior` permite forzar respuestas concretas:
 *   behavior.status: código a devolver en vez de 200
 *   behavior.empty: devolver una respuesta sin traducción
 *   behavior.delayMs: retrasar la respuesta
 */
async function startFakeTranslator(behavior = {}) {
  const calls = [];

  const server = http.createServer(async (req, res) => {
    const url = req.url || '';
    const body = await readBody(req);

    if (behavior.delayMs) {
      await new Promise((r) => setTimeout(r, behavior.delayMs));
    }

    // --- DeepL ---
    if (url.startsWith('/deepl/v2/translate')) {
      const params = new URLSearchParams(body);
      const text = params.get('text') || '';
      const target = (params.get('target_lang') || '').toLowerCase();
      calls.push({
        provider: 'deepl',
        text,
        target,
        source: params.get('source_lang'),
        auth: req.headers.authorization,
      });

      if (behavior.status) return json(res, behavior.status, { message: 'forzado' });
      if (behavior.empty) return json(res, 200, { translations: [] });

      const entry = DICTIONARY[text];
      const translated = entry?.[target];
      // El origen detectado se deduce de la propia frase, no se fija a 'ES':
      // si no, la traducción chino→español se atribuiría a un origen español y
      // el test comprobaría una mentira del servidor falso.
      const detected = Object.keys(entry || {}).includes('es') && /[\u4e00-\u9fff]/u.test(text)
        ? 'ZH'
        : 'ES';

      if (!translated) {
        return json(res, 200, { translations: [{ text, detected_source_language: detected }] });
      }

      return json(res, 200, {
        translations: [{ text: translated, detected_source_language: detected }],
      });
    }

    // --- Google ---
    if (url.startsWith('/google/language/translate/v2')) {
      const parsed = new URL(`http://x${url}`);
      const text = parsed.searchParams.get('q') || '';
      const target = (parsed.searchParams.get('target') || '').toLowerCase();
      calls.push({ provider: 'google', text, target, key: parsed.searchParams.get('key') });

      if (behavior.status) return json(res, behavior.status, { error: { message: 'forzado' } });
      if (behavior.empty) return json(res, 200, { data: { translations: [] } });

      const translated = DICTIONARY[text]?.[target];
      if (!translated) {
        return json(res, 200, {
          data: { translations: [{ translatedText: text, detectedSourceLanguage: 'es' }] },
        });
      }
      return json(res, 200, {
        data: { translations: [{ translatedText: translated, detectedSourceLanguage: 'es' }] },
      });
    }

    // --- LibreTranslate ---
    if (url.startsWith('/libre/translate')) {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      calls.push({ provider: 'libretranslate', ...parsed });
      if (behavior.status) return json(res, behavior.status, { error: 'forzado' });
      const translated = DICTIONARY[parsed.q]?.[parsed.target];
      return json(res, 200, {
        translatedText: translated || parsed.q,
        detectedLanguage: { language: parsed.source === 'auto' ? 'es' : parsed.source },
      });
    }

    // --- MyMemory (proveedor sin clave) ---
    if (url.startsWith('/mymemory/get')) {
      const parsed = new URL(`http://x${url}`);
      const text = parsed.searchParams.get('q') || '';
      const [from, to] = (parsed.searchParams.get('langpair') || '').split('|');
      calls.push({
        provider: 'mymemory',
        text,
        target: (to || '').toLowerCase(),
        source: from,
        de: parsed.searchParams.get('de'),
      });

      if (behavior.status) return json(res, behavior.status, { responseStatus: 403 });
      if (behavior.empty) {
        return json(res, 200, { responseData: { translatedText: '' }, responseStatus: 200 });
      }

      // MyMemory contesta 200 con un error dentro cuando se pasa la cuota o la
      // consulta no vale. Se reproduce para poder comprobar que ese texto de
      // error no acaba en la burbuja como si fuera la traducción.
      if (behavior.quotaExceeded) {
        return json(res, 200, {
          responseData: {
            translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY',
          },
          responseStatus: 403,
        });
      }

      const translated = DICTIONARY[text]?.[(to || '').toLowerCase()];
      return json(res, 200, {
        responseData: { translatedText: translated || text },
        responseStatus: 200,
      });
    }

    return json(res, 404, { error: 'ruta desconocida' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeTranslator, DICTIONARY };
