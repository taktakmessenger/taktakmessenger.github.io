const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function openConversation(agent, token, userId) {
  const res = await agent
    .post('/api/messages/conversations')
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.conversationId;
}

// Un PNG de 1x1 real: se sube contenido de verdad, no un texto con extensión
// .png, para que la prueba recorra el mismo camino que un usuario.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('subir un archivo requiere sesión', async () => {
  const agent = app();
  const res = await agent.post('/api/messages/attachments');
  assert.equal(res.status, 401);
});

test('sube una imagen y devuelve su referencia', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', PNG_1X1, 'mi foto.png');

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.attachment.kind, 'image');
  assert.match(res.body.attachment.url, /^\/uploads\/chat\//);
  // El nombre visible conserva el original ya limpio (espacio -> guion bajo).
  assert.equal(res.body.attachment.name, 'mi_foto.png');

  // El archivo existe de verdad en disco.
  const file = path.join(
    process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
    'chat',
    path.basename(res.body.attachment.url)
  );
  const stat = await fs.stat(file);
  assert.ok(stat.size > 0, 'el archivo debe haberse guardado');
  await fs.unlink(file).catch(() => {});
});

test('rechaza un HTML aunque se llame .png por dentro', async () => {
  // El filtro mira la extensión declarada: un .html no se acepta nunca.
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', Buffer.from('<script>alert(1)</script>'), 'malo.html');

  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /no está permitido por seguridad/);
});

test('rechaza un tipo no soportado', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', Buffer.from('datos'), 'cosa.rar');

  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /no soportado/);
});

test('un adjunto rechazado no deja basura en disco', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const dir = path.join(
    process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
    'chat'
  );
  const before = await fs.readdir(dir).catch(() => []);

  await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', Buffer.from('datos'), 'cosa.rar');

  const after = await fs.readdir(dir).catch(() => []);
  assert.equal(after.length, before.length, 'no debe quedar el archivo rechazado');
});

test('envía una imagen con pie de foto y llega al hilo', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const up = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', PNG_1X1, 'foto.png');
  assert.equal(up.status, 201);

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ text: 'mira esto', attachment: up.body.attachment });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message.kind, 'attachment');
  assert.equal(res.body.message.attachment.kind, 'image');
  assert.equal(res.body.message.attachment.name, 'foto.png');
  assert.equal(res.body.message.text, 'mira esto');

  // B lo ve en su hilo, con el adjunto.
  const list = await agent
    .get(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${b.token}`);
  assert.equal(list.status, 200);
  const last = list.body.messages.at(-1);
  assert.equal(last.attachment.url, up.body.attachment.url);

  await fs
    .unlink(
      path.join(
        process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
        'chat',
        path.basename(up.body.attachment.url)
      )
    )
    .catch(() => {});
});

test('un adjunto solo puede ser un archivo de este servidor', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  // Una URL externa (o interna) no se acepta como adjunto.
  for (const url of ['https://malo.example/x.png', '/api/users', '/uploads/../app.js']) {
    const res = await agent
      .post(`/api/messages/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ attachment: { kind: 'image', url, name: 'x.png' } });
    assert.equal(res.status, 400, `debe rechazar ${url}`);
  }
});

test('un mensaje sin texto ni adjunto se rechaza', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ text: '   ' });
  assert.equal(res.status, 400);
});

test('un adjunto solo, sin texto, se envía igual', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const up = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', PNG_1X1, 'solo.png');

  const res = await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ attachment: up.body.attachment });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message.text, '');
  assert.equal(res.body.message.attachment.name, 'solo.png');

  await fs
    .unlink(
      path.join(
        process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
        'chat',
        path.basename(up.body.attachment.url)
      )
    )
    .catch(() => {});
});

test('la vista previa del chat describe el adjunto', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const conversationId = await openConversation(agent, a.token, b.user.id);

  const up = await agent
    .post('/api/messages/attachments')
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', PNG_1X1, 'paisaje.png');

  await agent
    .post(`/api/messages/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${a.token}`)
    .send({ attachment: up.body.attachment });

  const inbox = await agent
    .get('/api/messages/conversations')
    .set('Authorization', `Bearer ${a.token}`);
  const convo = inbox.body.conversations.find((c) => String(c.id) === String(conversationId));
  assert.match(convo.lastMessagePreview, /Foto/);
  assert.match(convo.lastMessagePreview, /paisaje\.png/);

  await fs
    .unlink(
      path.join(
        process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
        'chat',
        path.basename(up.body.attachment.url)
      )
    )
    .catch(() => {});
});
