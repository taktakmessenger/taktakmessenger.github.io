// Traducción de texto para WhaTaka.
//
// El objetivo es que dos personas que no comparten idioma puedan hablar por el
// chat, por nota de voz y por llamada, cada una leyendo y oyendo en el suyo. Ese
// "en el suyo" se resuelve aquí: el servicio recibe un texto y el idioma de
// quien lo va a leer, y devuelve el texto en ese idioma.
//
// El proveedor es conmutable y opcional, igual que Stripe o PayPal en esta app:
//
//   - Con `TRANSLATE_PROVIDER` y su clave, se llama al proveedor real.
//   - Sin nada configurado, se usa un proveedor "local" que no traduce pero
//     devuelve el texto con la marca de que no hubo traducción.
//
// Ese último caso no es un adorno: es lo que permite que la función exista y se
// pruebe antes de contratar un servicio. La app nunca miente diciendo que
// tradujo: `translated: false` distingue "no hizo falta" de "no se pudo".

const env = require('../config/env');
const { HttpError } = require('../utils/http');
const { normalizeLanguage, sameLanguage, planTranslation } = require('../lib/language');

// Caché en memoria de traducciones. Es un chat: la misma frase se repite mucho
// ("hola", "¿cómo estás?", "jaja") y cada repetición sería una llamada de pago.
// La clave incluye origen y destino, porque la misma frase se traduce distinto
// según a dónde vaya.
//
// Es deliberadamente un Map con tope y no un Redis: el ahorro está en el caso
// caliente (las últimas frases), y un proceso que se reinicia solo pierde la
// caché, no datos.
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

function cacheKey(provider, from, to, text) {
  return `${provider}|${from}|${to}|${text}`;
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Reinsertar mueve la entrada al final: el Map conserva el orden de inserción,
  // así que borrar la primera clave es borrar la menos usada recientemente.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function writeCache(key, value) {
  cache.set(key, { value, at: Date.now() });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function clearCache() {
  cache.clear();
}

// --- Proveedores ------------------------------------------------------------

/**
 * Un proveedor es `{ name, isConfigured(), translate({ text, from, to }) }`.
 * Todos devuelven `{ text, detectedSource }` y lanzan `HttpError` si fallan, de
 * forma que la ruta pueda responder con un mensaje útil.
 */

// Proveedor local: no traduce. Existe para que la función esté completa y
// probable sin contratar nada, y para que el chat no se rompa si el servicio de
// traducción se cae: se sirve el original y la interfaz dice que no se pudo
// traducir, en vez de dejar la burbuja en blanco.
const localProvider = {
  name: 'local',
  isConfigured: () => true,
  async translate({ text, from }) {
    return { text, detectedSource: from || null, translated: false };
  },
};

// DeepL. Es el que mejor va en los pares de idiomas europeos y acepta el
// `target_lang` con variantes regionales. La clave gratuita termina en `:fx` y
// vive en otro host, así que la base es configurable.
const deeplProvider = {
  name: 'deepl',
  isConfigured: () => Boolean(env.translateApiKey),
  async translate({ text, from, to }) {
    const base = env.translateApiBase || 'https://api-free.deepl.com/v2';
    // DeepL quiere el idioma en mayúsculas y sin región para la mayoría de
    // casos; para el chino distingue ZH-HANS y ZH-HANT, que es justo lo que
    // guardamos.
    const target = to.toUpperCase();
    const body = new URLSearchParams({ text, target_lang: target });
    if (from) body.set('source_lang', from.toUpperCase());

    const res = await fetch(`${base}/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${env.translateApiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (res.status === 429) throw new HttpError(429, 'El traductor está saturado, prueba en un momento');
    if (res.status === 456) throw new HttpError(402, 'La cuota del traductor se ha agotado');
    if (!res.ok) throw new HttpError(502, 'El traductor no está disponible');

    const data = await res.json();
    const first = data?.translations?.[0];
    if (!first?.text) throw new HttpError(502, 'El traductor devolvió una respuesta vacía');
    return {
      text: first.text,
      detectedSource: normalizeLanguage(first.detected_source_language) || from || null,
      translated: true,
    };
  },
};

// Google Cloud Translation (v2). Acepta el par de idiomas como query y
// devuelve las detecciones cuando no se fija el origen.
const googleProvider = {
  name: 'google',
  isConfigured: () => Boolean(env.translateApiKey),
  async translate({ text, from, to }) {
    const base = env.translateApiBase || 'https://translation.googleapis.com/language/translate/v2';
    const url = new URL(base);
    url.searchParams.set('key', env.translateApiKey);
    url.searchParams.set('q', text);
    url.searchParams.set('target', to);
    // El chino de Google no distingue simplificado/tradicional por el código de
    // destino; se pide con `zh-CN` / `zh-TW`, que sí lo hacen.
    if (to === 'zh-Hans') url.searchParams.set('target', 'zh-CN');
    if (to === 'zh-Hant') url.searchParams.set('target', 'zh-TW');
    if (from) {
      url.searchParams.set('source', from === 'zh-Hans' ? 'zh-CN' : from === 'zh-Hant' ? 'zh-TW' : from);
    }

    const res = await fetch(url, { method: 'POST' });
    if (res.status === 429) throw new HttpError(429, 'El traductor está saturado, prueba en un momento');
    if (!res.ok) throw new HttpError(502, 'El traductor no está disponible');

    const data = await res.json();
    const first = data?.data?.translations?.[0];
    if (!first?.translatedText) throw new HttpError(502, 'El traductor devolvió una respuesta vacía');
    // Google devuelve el texto con entidades HTML escapadas.
    const decoded = String(first.translatedText)
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return {
      text: decoded,
      detectedSource: normalizeLanguage(first.detectedSourceLanguage) || from || null,
      translated: true,
    };
  },
};

// LibreTranslate: software libre que se puede autoalojar. Es la opción para
// quien no quiere mandar las conversaciones a un tercero, que en una app de
// mensajería es una consideración real.
const libretranslateProvider = {
  name: 'libretranslate',
  isConfigured: () => Boolean(env.translateApiBase),
  async translate({ text, from, to }) {
    const base = env.translateApiBase;
    const res = await fetch(`${base}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.translateApiKey ? { Authorization: `Bearer ${env.translateApiKey}` } : {}),
      },
      body: JSON.stringify({
        q: text,
        source: from || 'auto',
        target: to.split('-')[0],
        format: 'text',
      }),
    });

    if (!res.ok) throw new HttpError(502, 'El traductor no está disponible');
    const data = await res.json();
    if (!data?.translatedText) throw new HttpError(502, 'El traductor devolvió una respuesta vacía');
    return {
      text: data.translatedText,
      detectedSource: normalizeLanguage(data.detectedLanguage?.language) || from || null,
      translated: true,
    };
  },
};

// MyMemory: traducción sin contratar nada y sin clave.
//
// Existe por un motivo concreto: la app tiene que poder traducir de verdad al
// instalarla, no solo "cuando alguien pegue una clave". Con DeepL o Google, el
// día uno la función estrella de WhaTaka (hablar con quien no comparte tu
// idioma) no hace nada, y eso convierte una promesa en una demo. Con este
// proveedor, la traducción funciona recién clonado y sigue funcionando el día
// que se contrate uno mejor: `auto` prefiere DeepL y Google antes que este.
//
// Límites reales del servicio, y cómo se tratan:
//   - 500 caracteres por consulta. Un mensaje largo se trocea por frases y se
//     vuelve a unir, así que el chat no se queda sin traducir por escribir una
//     parrafada.
//   - Cuota diaria anónima, ampliable pasando un correo con `de=`.
//   - El chino necesita `zh-CN` / `zh-TW`, no los códigos internos.
//
// Lo que NO se hace: reintentar en bucle. Si el servicio contesta 429 o se pasa
// la cuota, se lanza el error y la interfaz dice que no se pudo traducir. Un
// reintento agresivo contra un servicio gratuito es la forma más rápida de que
// bloqueen la IP.
const MYMEMORY_MAX_CHARS = 450;
// Base configurable para poder apuntar los tests a un servidor falso, igual que
// DeepL y Google. Sin ella, la suite de este proveedor dependería de internet.
const MYMEMORY_BASE = 'https://api.mymemory.translated.net';

// El código que entiende MyMemory. El chino es el caso que importa: no acepta
// `zh-Hans`, y confundir simplificado con tradicional cambia el texto.
function mymemoryCode(code) {
  if (code === 'zh-Hans') return 'zh-CN';
  if (code === 'zh-Hant') return 'zh-TW';
  return code;
}

// Parte el texto en trozos que quepan en una consulta, cortando por frase y, si
// una sola frase no cabe, por palabra. Cortar a mitad de palabra traduce mal
// ("conside|ración"), así que se evita mientras se pueda.
function splitForMymemory(text, max = MYMEMORY_MAX_CHARS) {
  const clean = String(text ?? '').trim();
  if (clean.length <= max) return [clean];

  const chunks = [];
  let current = '';

  for (const sentence of clean.split(/(?<=[.!?。！？\n])\s*/)) {
    if (!sentence) continue;
    if (sentence.length > max) {
      // Frase más larga que el límite: se parte por palabras.
      if (current) {
        chunks.push(current);
        current = '';
      }
      let line = '';
      for (const word of sentence.split(/\s+/)) {
        if (line && `${line} ${word}`.length > max) {
          chunks.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) chunks.push(line);
      continue;
    }
    if (current && `${current} ${sentence}`.length > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

const mymemoryProvider = {
  name: 'mymemory',
  // No hay clave que comprobar: el servicio es abierto. Se puede apagar con
  // `TRANSLATE_KEYLESS=false` para quien no quiera mandar texto a un tercero
  // gratuito, que en una app de mensajería es una decisión legítima.
  //
  // En tests queda apagado salvo que se pida por su nombre: si no, cualquier
  // suite que no configure proveedor saldría a internet y los tests dejarían de
  // ser herméticos (y fallarían sin red).
  isConfigured: () => env.translateKeyless !== false && !env.isTest,
  async translate({ text, from, to }) {
    const chunks = splitForMymemory(text);
    const parts = [];

    for (const chunk of chunks) {
      const url = new URL(`${env.translateApiBase || MYMEMORY_BASE}/get`);
      url.searchParams.set('q', chunk);
      // Sin origen detectado se pide autodetección, que es lo que el servicio
      // resuelve solo.
      url.searchParams.set('langpair', `${mymemoryCode(from || 'Autodetect')}|${mymemoryCode(to)}`);
      // Un correo sube la cuota anónima. Es opcional: sin él funciona igual.
      if (env.translateContactEmail) url.searchParams.set('de', env.translateContactEmail);

      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, { method: 'GET' });

      if (res.status === 429) throw new HttpError(429, 'El traductor está saturado, prueba en un momento');
      if (!res.ok) throw new HttpError(502, 'El traductor no está disponible');

      // eslint-disable-next-line no-await-in-loop
      const data = await res.json();
      const status = Number(data?.responseStatus);
      const translated = data?.responseData?.translatedText;

      // El servicio contesta 200 con un mensaje de error dentro cuando la cuota
      // se agotó o la consulta era inválida; sin este control, ese texto de
      // error se colaría en la burbuja como si fuera la traducción.
      if (status !== 200 || typeof translated !== 'string' || !translated.trim()) {
        throw new HttpError(502, 'El traductor no pudo traducir el texto');
      }
      parts.push(translated.trim());
    }

    return {
      text: parts.join(' '),
      detectedSource: normalizeLanguage(from) || from || null,
      translated: true,
    };
  },
};

const PROVIDERS = {
  deepl: deeplProvider,
  google: googleProvider,
  libretranslate: libretranslateProvider,
  mymemory: mymemoryProvider,
  local: localProvider,
};

// Proveedor activo. `auto` (el valor por defecto) elige el primero que esté
// configurado y cae al local si no hay ninguno, así que la app funciona recién
// clonada y empieza a traducir sola el día que se pega una clave.
function activeProvider() {
  const configured = String(env.translateProvider || 'auto').toLowerCase();
  if (configured !== 'auto') {
    const provider = PROVIDERS[configured];
    if (!provider) throw new HttpError(500, `Traductor desconocido: ${configured}`);
    return provider;
  }
  for (const name of ['deepl', 'google', 'libretranslate', 'mymemory']) {
    if (PROVIDERS[name].isConfigured()) return PROVIDERS[name];
  }
  return localProvider;
}

function isConfigured() {
  return activeProvider().name !== 'local';
}

/**
 * Traduce `text` al idioma `to`.
 *
 * Devuelve `{ text, source, target, translated, confidence, reason, provider }`.
 * `translated: false` significa que se devuelve el original: o no hacía falta
 * (ya estaba en el idioma de destino, o no es texto traducible) o no hay
 * proveedor. En ningún caso se inventa una traducción.
 */
async function translate({ text, to, from = null, hint = null }) {
  const target = normalizeLanguage(to);
  if (!target) throw new HttpError(400, 'Idioma de destino no soportado');

  const plan = planTranslation({ text, target, hint });

  if (!plan.needed) {
    return {
      text: String(text ?? ''),
      source: plan.source,
      target,
      translated: false,
      confidence: plan.confidence,
      reason: plan.reason,
      provider: null,
    };
  }

  const provider = activeProvider();

  // Si el idioma de origen es el mismo que el de destino no se llama al
  // proveedor ni siquiera cuando no se pudo detectar con seguridad: se avisa de
  // que no hizo falta.
  if (plan.source && sameLanguage(plan.source, target)) {
    return {
      text: String(text ?? ''),
      source: plan.source,
      target,
      translated: false,
      confidence: plan.confidence,
      reason: 'same-language',
      provider: null,
    };
  }

  const key = cacheKey(provider.name, plan.source || 'auto', target, text);
  const cached = readCache(key);
  if (cached) {
    return { ...cached, cached: true };
  }

  const result = await provider.translate({ text, from: plan.source, to: target });

  const payload = {
    text: result.text,
    source: result.detectedSource || plan.source,
    target,
    translated: result.translated !== false,
    confidence: plan.confidence,
    reason: plan.reason,
    provider: provider.name,
  };

  // El proveedor local no traduce: cachear el original bajo la clave del idioma
  // de destino haría que, el día que se configure una clave, se siguieran
  // sirviendo originales "cacheados" durante horas.
  if (payload.translated) writeCache(key, payload);

  return payload;
}

/**
 * Traduce varios textos de una vez, en serie. Se usa poco (el chat traduce de
 * uno en uno), pero existe para la traducción de un lote de mensajes al abrir un
 * hilo, donde hacer N peticiones en paralelo contra el proveedor lo saturaría.
 */
async function translateMany(items, { to, hint = null }) {
  const out = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await translate({ text: item, to, hint }));
  }
  return out;
}

module.exports = {
  translate,
  translateMany,
  isConfigured,
  activeProvider,
  clearCache,
};
