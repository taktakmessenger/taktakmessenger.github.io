// Transcripción de notas de voz: el servicio y su ruta.
//
// Lo que de verdad se prueba aquí es la seguridad. La transcripción es un
// endpoint autenticado que lee un archivo del disco a partir de una ruta que
// manda el cliente, así que los dos fallos que hay que descartar son:
//
//   1. que la ruta se salga de la carpeta de adjuntos (path traversal), y
//   2. que se pueda transcribir el audio de otra persona con solo conocer su
//      ruta, que se ve en el DOM del chat.
//
// El proveedor se prueba contra un servidor HTTP real, como el traductor.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const env = require('../src/config/env');
const transcriptionService = require('../src/services/transcriptionService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// --- Resolución de rutas -----------------------------------------------------

test('resuelve una ruta válida dentro de la carpeta de adjuntos', () => {
  const resolved = transcriptionService.resolveAttachmentPath('/uploads/chat/123-abc.webm');
  assert.match(resolved.filePath, /uploads[\\/]chat[\\/]123-abc\.webm$/);
  assert.equal(resolved.ext, '.webm');
  assert.equal(resolved.mime, 'audio/webm');
});

test('rechaza una URL absoluta: sería un SSRF', () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'https://evil.example/audio.mp3',
    'file:///etc/passwd',
    '//evil.example/audio.mp3',
  ]) {
    assert.throws(
      () => transcriptionService.resolveAttachmentPath(url),
      /no válido|no se puede/i,
      `debería rechazar ${url}`
    );
  }
});

test('rechaza un path traversal que salga de la carpeta de adjuntos', () => {
  for (const url of [
    '/uploads/chat/../../../../etc/passwd',
    '/uploads/chat/../../../backend/src/config/env.js',
    'uploads/../secreto.webm',
  ]) {
    assert.throws(
      () => transcriptionService.resolveAttachmentPath(url),
      /no válido|no se puede/i,
      `debería rechazar ${url}`
    );
  }
});

test('rechaza rutas fuera de la subcarpeta del chat', () => {
  // Un vídeo del feed no es una nota de voz: aunque esté en `uploads`, no se
  // transcribe.
  assert.throws(
    () => transcriptionService.resolveAttachmentPath('/uploads/videos/algo.webm'),
    /no válido/i
  );
});

test('rechaza un formato que no es audio', () => {
  assert.throws(
    () => transcriptionService.resolveAttachmentPath('/uploads/chat/nota.pdf'),
    /no se puede transcribir/i
  );
  assert.throws(
    () => transcriptionService.resolveAttachmentPath('/uploads/chat/foto.jpg'),
    /no se puede transcribir/i
  );
});

test('rechaza una ruta vacía', () => {
  assert.throws(() => transcriptionService.resolveAttachmentPath(''), /Falta el adjunto/i);
  assert.throws(() => transcriptionService.resolveAttachmentPath(null), /Falta el adjunto/i);
});

// --- Ruta HTTP ---------------------------------------------------------------

test('sin sesión, la transcripción se rechaza', async () => {
  const agent = app();
  const res = await agent.post('/api/messages/transcribe').send({
    url: '/uploads/chat/123-abc.webm',
  });
  assert.equal(res.status, 401);
});

test('un adjunto que no es de una conversación mía da 404', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  // La ruta tiene el formato correcto, pero no existe ningún mensaje con ella:
  // no se puede transcribir el audio de otro conociendo solo la ruta.
  const res = await agent
    .post('/api/messages/transcribe')
    .set('Authorization', `Bearer ${token}`)
    .send({ url: '/uploads/chat/ajeno-123.webm' });

  assert.equal(res.status, 404);
});

test('una ruta maliciosa se rechaza aunque la petición venga autenticada', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent
    .post('/api/messages/transcribe')
    .set('Authorization', `Bearer ${token}`)
    .send({ url: 'http://169.254.169.254/latest/meta-data/' });

  // 404 porque el adjunto no pertenece a ninguna conversación suya, que es la
  // primera comprobación: ni siquiera se llega a resolver la ruta.
  assert.equal(res.status, 404);
});

// Abre una conversación entre dos usuarios y deja en ella una nota de voz del
// primero, que es el caso que la transcripción tiene que atender.
async function conversationWithVoiceNote(agent, filename = 'nota.webm') {
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const conv = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ userId: b.user.id });
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  const conversationId = conv.body.conversationId;

  const audio = Buffer.from('OggS fake opus audio');
  const up = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', audio, { filename, contentType: 'audio/webm' });
  assert.equal(up.status, 201, JSON.stringify(up.body));

  const sent = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ attachment: up.body.attachment });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  return { a, b, url: up.body.attachment.url };
}

test('sin proveedor configurado responde 503 para que el cliente use el navegador', async () => {
  const agent = app();
  const { a, url } = await conversationWithVoiceNote(agent);

  const original = { provider: env.sttProvider, apiKey: env.sttApiKey };
  env.sttProvider = null;
  env.sttApiKey = null;

  try {
    const res = await agent
      .post('/api/messages/transcribe')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ url });

    // 503 y no 500: el cliente usa este código para caer al reconocimiento local
    // sin enseñar un error.
    assert.equal(res.status, 503);
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
  }
});

test('solo los participantes de la conversación pueden transcribir su nota', async () => {
  const agent = app();
  const { a, b, url } = await conversationWithVoiceNote(agent);

  const original = { provider: env.sttProvider, apiKey: env.sttApiKey };
  env.sttProvider = null;
  env.sttApiKey = null;

  try {
    // El receptor sí puede: el adjunto está en una conversación suya.
    const asB = await agent
      .post('/api/messages/transcribe')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ url });
    assert.equal(asB.status, 503, 'el otro participante sí tiene acceso');

    // Un tercero, no. Aunque conozca la ruta exacta, que se ve en el DOM.
    const c = await registerUser(agent);
    const asC = await agent
      .post('/api/messages/transcribe')
      .set('Authorization', `Bearer ${c.token}`)
      .send({ url });
    assert.equal(asC.status, 404, 'un desconocido no puede transcribir audio ajeno');
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
  }
});

test('con proveedor, la ruta transcribe la nota y devuelve el texto', async () => {
  const agent = app();
  const { a, url } = await conversationWithVoiceNote(agent);

  const fake = await startFakeStt({ body: { text: 'nos vemos mañana' } });
  const original = {
    provider: env.sttProvider,
    apiKey: env.sttApiKey,
    base: env.translateApiBase,
  };
  env.sttProvider = 'openai';
  env.sttApiKey = 'fake-stt-key';
  env.translateApiBase = fake.baseUrl;

  try {
    const res = await agent
      .post('/api/messages/transcribe')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ url, language: 'es-ES' });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.text, 'nos vemos mañana');
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
    env.translateApiBase = original.base;
    await fake.close();
  }
});

// --- Proveedor ---------------------------------------------------------------

// Servidor HTTP real que imita a un proveedor de STT. Igual que con el traductor,
// se ejercita el camino de producción en vez de sustituir la función.
async function startFakeStt({ status = 200, body = { text: 'hola mundo' } } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('con proveedor openai, envía el archivo y devuelve el texto', async () => {
  const fake = await startFakeStt({ body: { text: '  hola mundo  ' } });
  const original = { provider: env.sttProvider, apiKey: env.sttApiKey, base: env.translateApiBase };
  env.sttProvider = 'openai';
  env.sttApiKey = 'fake-stt-key';
  env.translateApiBase = fake.baseUrl;

  // Archivo real en la carpeta de adjuntos.
  const dir = path.join(env.uploadsDir, 'chat');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'prueba-stt.webm');
  await fs.writeFile(filePath, Buffer.from('audio de prueba'));

  try {
    const result = await transcriptionService.transcribeWithProvider({
      filePath,
      ext: '.webm',
      mime: 'audio/webm',
      language: 'es-ES',
    });

    assert.equal(result.text, 'hola mundo', 'el texto se recorta');
    assert.equal(fake.received.length, 1);
    assert.match(fake.received[0].url, /audio\/transcriptions/);
    assert.match(fake.received[0].headers.authorization, /^Bearer /);
    // El idioma se manda sin la región: los proveedores esperan `es`, no `es-ES`.
    assert.match(String(fake.received[0].body), /es/);
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
    env.translateApiBase = original.base;
    await fs.rm(filePath, { force: true });
    await fake.close();
  }
});

test('un proveedor que responde con error da un 502, no un 500', async () => {
  const fake = await startFakeStt({ status: 500, body: { error: 'boom' } });
  const original = { provider: env.sttProvider, apiKey: env.sttApiKey, base: env.translateApiBase };
  env.sttProvider = 'openai';
  env.sttApiKey = 'fake-stt-key';
  env.translateApiBase = fake.baseUrl;

  const dir = path.join(env.uploadsDir, 'chat');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'prueba-error.webm');
  await fs.writeFile(filePath, Buffer.from('audio'));

  try {
    await assert.rejects(
      () =>
        transcriptionService.transcribeWithProvider({
          filePath,
          ext: '.webm',
          mime: 'audio/webm',
        }),
      /No se pudo transcribir/i
    );
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
    env.translateApiBase = original.base;
    await fs.rm(filePath, { force: true });
    await fake.close();
  }
});

test('una respuesta vacía del proveedor es un error, no una transcripción vacía', async () => {
  const fake = await startFakeStt({ body: {} });
  const original = { provider: env.sttProvider, apiKey: env.sttApiKey, base: env.translateApiBase };
  env.sttProvider = 'openai';
  env.sttApiKey = 'fake-stt-key';
  env.translateApiBase = fake.baseUrl;

  const dir = path.join(env.uploadsDir, 'chat');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'prueba-vacia.webm');
  await fs.writeFile(filePath, Buffer.from('audio'));

  try {
    await assert.rejects(
      () =>
        transcriptionService.transcribeWithProvider({
          filePath,
          ext: '.webm',
          mime: 'audio/webm',
        }),
      /vacía/i
    );
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
    env.translateApiBase = original.base;
    await fs.rm(filePath, { force: true });
    await fake.close();
  }
});

test('isConfigured solo con proveedor y clave', () => {
  const original = { provider: env.sttProvider, apiKey: env.sttApiKey };
  try {
    env.sttProvider = null;
    env.sttApiKey = null;
    assert.equal(transcriptionService.isConfigured(), false);

    env.sttProvider = 'openai';
    assert.equal(transcriptionService.isConfigured(), false, 'sin clave no está configurado');

    env.sttApiKey = 'k';
    assert.equal(transcriptionService.isConfigured(), true);
  } finally {
    env.sttProvider = original.provider;
    env.sttApiKey = original.apiKey;
  }
});
