// Traducción de WhaTaka: el servicio y su API.
//
// Se usa un servidor HTTP real (fakeTranslator) y se apunta el servicio a él,
// igual que se hace con Stripe y PayPal: así se ejercita el mismo camino que en
// producción en vez de sustituir `translate` por un doble.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const { startFakeTranslator } = require('./fakeTranslator');
const env = require('../src/config/env');
const translationService = require('../src/services/translationService');
const User = require('../src/models/User');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Arranca el traductor falso y apunta el servicio a él. `restore` se llama
// siempre en un `finally`, también cuando el test falla: si no, la caché y el
// proveedor quedarían contaminados para el resto de la suite.
//
// `provider` permite elegir cuál se ejercita. Por defecto DeepL, que es el
// camino de pago; los tests del proveedor sin clave piden 'mymemory'.
async function withTranslator(behavior, fn, { provider = 'deepl' } = {}) {
  const fake = await startFakeTranslator(behavior);
  const original = {
    provider: env.translateProvider,
    apiKey: env.translateApiKey,
    apiBase: env.translateApiBase,
  };

  env.translateProvider = provider;
  env.translateApiKey = 'fake-key';
  env.translateApiBase =
    provider === 'mymemory' ? `${fake.baseUrl}/mymemory` : `${fake.baseUrl}/deepl/v2`;
  translationService.clearCache();

  try {
    return await fn(fake);
  } finally {
    env.translateProvider = original.provider;
    env.translateApiKey = original.apiKey;
    env.translateApiBase = original.apiBase;
    translationService.clearCache();
    await fake.close();
  }
}

// --- Servicio ---------------------------------------------------------------

test('traduce español a inglés por el proveedor configurado', async () => {
  await withTranslator({}, async (fake) => {
    const result = await translationService.translate({
      text: 'Hola, ¿cómo estás?',
      to: 'en',
    });

    assert.equal(result.text, 'Hello, how are you?');
    assert.equal(result.source, 'es');
    assert.equal(result.target, 'en');
    assert.equal(result.translated, true);
    assert.equal(result.provider, 'deepl');
    assert.equal(fake.calls.length, 1, 'debe haber una sola llamada al proveedor');
  });
});

test('traduce español a chino simplificado, que es el caso del enunciado', async () => {
  await withTranslator({}, async (fake) => {
    const result = await translationService.translate({
      text: '¿Puedes llamarme mañana?',
      to: 'zh-CN',
    });

    assert.equal(result.text, '你明天能给我打电话吗？');
    assert.equal(result.target, 'zh-Hans');
    assert.equal(result.translated, true);
    // El proveedor recibe el código que entiende, en mayúsculas y sin región.
    assert.equal(fake.calls[0].target, 'zh-hans');
  });
});

test('traduce chino a español, el sentido inverso', async () => {
  await withTranslator({}, async () => {
    const result = await translationService.translate({ text: '你好，你好吗？', to: 'es' });
    assert.equal(result.text, 'Hola, ¿cómo estás?');
    assert.equal(result.source, 'zh-Hans');
    assert.equal(result.target, 'es');
  });
});

test('no llama al proveedor si el texto ya está en el idioma de destino', async () => {
  await withTranslator({}, async (fake) => {
    const result = await translationService.translate({
      text: 'Hola, ¿cómo estás?',
      to: 'es',
    });

    assert.equal(result.translated, false);
    assert.equal(result.reason, 'same-language');
    assert.equal(result.text, 'Hola, ¿cómo estás?');
    assert.equal(fake.calls.length, 0, 'no debe gastar una llamada');
  });
});

test('no llama al proveedor con un texto que no es traducible', async () => {
  await withTranslator({}, async (fake) => {
    const result = await translationService.translate({ text: '👍', to: 'zh-Hans' });
    assert.equal(result.translated, false);
    assert.equal(result.reason, 'not-translatable');
    assert.equal(fake.calls.length, 0);
  });
});

test('la misma traducción no se pide dos veces (caché)', async () => {
  await withTranslator({}, async (fake) => {
    const first = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' });
    const second = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' });

    assert.equal(first.text, second.text);
    assert.equal(second.cached, true);
    assert.equal(fake.calls.length, 1, 'la segunda debe salir de la caché');
  });
});

test('la caché distingue el idioma de destino', async () => {
  await withTranslator({}, async (fake) => {
    const en = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' });
    const zh = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'zh-Hans' });

    assert.equal(en.text, 'Hello, how are you?');
    assert.equal(zh.text, '你好，你好吗？');
    assert.equal(fake.calls.length, 2, 'cada destino es una traducción distinta');
  });
});

test('un destino no soportado lanza 400', async () => {
  await withTranslator({}, async () => {
    await assert.rejects(
      () => translationService.translate({ text: 'Hola', to: 'klingon' }),
      (err) => err.status === 400
    );
  });
});

test('el proveedor saturado se traduce en un 429, no en un 500', async () => {
  await withTranslator({ status: 429 }, async () => {
    await assert.rejects(
      () => translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' }),
      (err) => err.status === 429
    );
  });
});

test('una respuesta vacía del proveedor es un 502', async () => {
  await withTranslator({ empty: true }, async () => {
    await assert.rejects(
      () => translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' }),
      (err) => err.status === 502
    );
  });
});

test('sin proveedor configurado se usa el local y no se miente', async () => {
  const original = {
    provider: env.translateProvider,
    apiKey: env.translateApiKey,
    apiBase: env.translateApiBase,
  };
  env.translateProvider = 'auto';
  env.translateApiKey = null;
  env.translateApiBase = null;
  translationService.clearCache();

  try {
    assert.equal(translationService.isConfigured(), false);
    assert.equal(translationService.activeProvider().name, 'local');

    const result = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' });
    assert.equal(result.text, 'Hola, ¿cómo estás?', 'devuelve el original');
    assert.equal(result.translated, false, 'y dice que no tradujo');
    assert.equal(result.provider, 'local');
  } finally {
    env.translateProvider = original.provider;
    env.translateApiKey = original.apiKey;
    env.translateApiBase = original.apiBase;
    translationService.clearCache();
  }
});

test('el proveedor local no cachea, para que configurar una clave surta efecto', async () => {
  const original = {
    provider: env.translateProvider,
    apiKey: env.translateApiKey,
    apiBase: env.translateApiBase,
  };
  env.translateProvider = 'local';
  env.translateApiKey = null;
  env.translateApiBase = null;
  translationService.clearCache();

  try {
    const local = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' });
    assert.equal(local.translated, false);
  } finally {
    env.translateProvider = original.provider;
    env.translateApiKey = original.apiKey;
    env.translateApiBase = original.apiBase;
    translationService.clearCache();
  }

  // Con un proveedor real, la misma frase debe traducirse de verdad: si el local
  // hubiera cacheado el original, se seguiría sirviendo el original.
  await withTranslator({}, async (fake) => {
    const result = await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' });
    assert.equal(result.translated, true);
    assert.equal(result.text, 'Hello, how are you?');
    assert.equal(fake.calls.length, 1);
  });
});

// --- API --------------------------------------------------------------------

test('GET /api/translate/languages es público y lista el catálogo', async () => {
  const res = await app().get('/api/translate/languages');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.languages));
  assert.ok(res.body.languages.length >= 20);
  const spanish = res.body.languages.find((l) => l.code === 'es');
  assert.equal(spanish.nativeName, 'Español');
  assert.equal(typeof res.body.configured, 'boolean');
});

test('POST /api/translate exige sesión', async () => {
  const res = await app().post('/api/translate').send({ text: 'Hola', to: 'en' });
  assert.equal(res.status, 401);
});

test('POST /api/translate traduce para un usuario con sesión', async () => {
  await withTranslator({}, async () => {
    const agent = app();
    const { token } = await registerUser(agent);

    const res = await agent
      .post('/api/translate')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Hola, ¿cómo estás?', to: 'zh-Hans' });

    assert.equal(res.status, 200);
    assert.equal(res.body.text, '你好，你好吗？');
    assert.equal(res.body.translated, true);
    assert.equal(res.body.target, 'zh-Hans');
  });
});

test('POST /api/translate valida el cuerpo', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const noText = await agent
    .post('/api/translate')
    .set('Authorization', `Bearer ${token}`)
    .send({ to: 'en' });
  assert.equal(noText.status, 400);

  const noTarget = await agent
    .post('/api/translate')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: 'Hola' });
  assert.equal(noTarget.status, 400);

  const badTarget = await agent
    .post('/api/translate')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: 'Hola', to: 'klingon' });
  assert.equal(badTarget.status, 400);
});

test('POST /api/translate/plan no gasta una traducción', async () => {
  await withTranslator({}, async (fake) => {
    const agent = app();
    const { token } = await registerUser(agent);

    const res = await agent
      .post('/api/translate/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '¿Puedes llamarme mañana?', to: 'zh-CN' });

    assert.equal(res.status, 200);
    assert.equal(res.body.needed, true);
    assert.equal(res.body.source, 'es');
    assert.equal(res.body.target, 'zh-Hans');
    assert.equal(fake.calls.length, 0, 'el plan no debe llamar al proveedor');
  });
});

test('POST /api/translate/batch traduce varios textos en serie', async () => {
  await withTranslator({}, async (fake) => {
    const agent = app();
    const { token } = await registerUser(agent);

    const res = await agent
      .post('/api/translate/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ texts: ['Hola, ¿cómo estás?', '¿Puedes llamarme mañana?'], to: 'en' });

    assert.equal(res.status, 200);
    assert.equal(res.body.translations.length, 2);
    assert.equal(res.body.translations[0].text, 'Hello, how are you?');
    assert.equal(res.body.translations[1].text, 'Can you call me tomorrow?');
    assert.equal(fake.calls.length, 2);
  });
});

test('POST /api/translate/detect detecta sin sesión', async () => {
  const res = await app().post('/api/translate/detect').send({ text: '你好，你好吗？' });
  assert.equal(res.status, 200);
  assert.equal(res.body.language, 'zh-Hans');
});

// --- Idioma preferido del usuario -------------------------------------------

test('el idioma preferido se guarda normalizado', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ preferredLanguage: 'zh-CN', autoTranslate: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.preferredLanguage, 'zh-Hans');
  assert.equal(res.body.user.autoTranslate, true);

  // Y se persiste de verdad, no solo en la respuesta.
  const stored = await User.findOne({ preferredLanguage: 'zh-Hans' });
  assert.ok(stored, 'el idioma debe quedar guardado');
});

test('un idioma no soportado se rechaza al guardar', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ preferredLanguage: 'klingon' });

  assert.equal(res.status, 400);
});

test('vaciar el idioma preferido lo deja sin preferencia', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  await agent
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ preferredLanguage: 'zh-Hans' });

  const res = await agent
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ preferredLanguage: null });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.preferredLanguage, null);
});

test('la traducción automática está apagada por defecto', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.get('/api/users/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.autoTranslate, false);
  assert.equal(res.body.user.preferredLanguage, null);
  assert.equal(res.body.user.callCaptions, true);
});

// --- Proveedor sin clave ----------------------------------------------------
//
// MyMemory es lo que hace que la app traduzca de verdad recién instalada, sin
// contratar nada. Tiene dos límites que hay que tratar bien: corta a 500
// caracteres y contesta 200 con un texto de error dentro cuando se pasa la
// cuota. Los dos casos se prueban porque los dos se ven en producción.

test('el proveedor sin clave traduce igual que los de pago', async () => {
  await withTranslator(
    {},
    async (fake) => {
      const result = await translationService.translate({
        text: 'Hola, ¿cómo estás?',
        to: 'en',
      });

      assert.equal(result.text, 'Hello, how are you?');
      assert.equal(result.translated, true);
      assert.equal(result.provider, 'mymemory');
      assert.equal(fake.calls.length, 1);
    },
    { provider: 'mymemory' }
  );
});

test('el chino se pide como zh-CN, no como zh-Hans', async () => {
  await withTranslator(
    {},
    async (fake) => {
      await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'zh-Hans' });

      // El servicio no conoce `zh-Hans`: si se mandara tal cual, no traduciría.
      assert.equal(fake.calls[0].target, 'zh-cn');
    },
    { provider: 'mymemory' }
  );
});

test('el chino tradicional se pide como zh-TW', async () => {
  await withTranslator(
    {},
    async (fake) => {
      await translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'zh-Hant' });

      assert.equal(fake.calls[0].target, 'zh-tw');
    },
    { provider: 'mymemory' }
  );
});

test('un texto largo se trocea y se vuelve a unir', async () => {
  await withTranslator(
    {},
    async (fake) => {
      // Por encima del límite de 500 del servicio: si no se troceara, la
      // consulta fallaría y el mensaje largo se quedaría sin traducir.
      const long = Array.from({ length: 20 }, (_, i) => `Frase numero ${i} de la prueba.`).join(' ');
      assert.ok(long.length > 450, 'el texto de prueba debe pasar del límite');

      const result = await translationService.translate({ text: long, to: 'en' });

      assert.equal(result.translated, true);
      assert.ok(fake.calls.length > 1, 'debe haber partido el texto en varias consultas');
      for (const call of fake.calls) {
        assert.ok(call.text.length <= 500, 'ninguna consulta puede pasar del límite');
      }
    },
    { provider: 'mymemory' }
  );
});

test('el aviso de cuota agotada no se devuelve como traducción', async () => {
  await withTranslator(
    { quotaExceeded: true },
    async () => {
      // El servicio contesta 200 con el aviso dentro. Sin comprobarlo, ese
      // aviso en inglés acabaría en la burbuja como si fuera la traducción.
      await assert.rejects(
        () => translationService.translate({ text: 'Hola, ¿cómo estás?', to: 'en' }),
        (err) => err.status === 502
      );
    },
    { provider: 'mymemory' }
  );
});

test('el proveedor sin clave se apaga en tests si no se pide', async () => {
  // `auto` no debe elegir MyMemory durante los tests: la suite saldría a
  // internet y dejaría de ser hermética.
  const provider = translationService.activeProvider();
  assert.notEqual(provider.name, 'mymemory');
});
