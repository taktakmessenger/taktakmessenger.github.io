const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const User = require('../src/models/User');
const voiceService = require('../src/services/voiceService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// El entorno de test no configura Twilio Voice, así que los endpoints de voz
// responden 503. Es justo lo que se quiere comprobar: que un despliegue sin
// proveedor falle con un mensaje claro en vez de fingir que llama.

test('voice availability requires a session', async () => {
  const agent = app();
  const res = await agent.get('/api/calls/voice');
  assert.equal(res.status, 401);
});

test('voice availability reports the truth when no provider is configured', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.get('/api/calls/voice').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.available, false);
  // Sin proveedor no hay número que mostrar a quien recibe la llamada.
  assert.equal(res.body.callerId, null);
});

test('requesting a voice token without a provider is refused, not faked', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.post('/api/calls/token').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 503);
  assert.match(res.body.error, /no están disponibles/i);
});

test('inviting a number that already has an account is rejected', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  await User.updateOne({ _id: b.user.id }, { phone: '+34600111222', phoneVerified: true });

  const res = await agent
    .post('/api/calls/invite')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '+34600111222' });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /ya tiene cuenta/i);
});

test('inviting an unknown number returns a link even without an SMS provider', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent
    .post('/api/calls/invite')
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '+34600999888' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Sin proveedor el SMS no sale, pero el enlace sí se devuelve: el usuario
  // puede compartirlo por otra vía en lugar de quedarse a medias.
  assert.equal(res.body.delivered, false);
  assert.equal(res.body.reason, 'no_provider');
  assert.match(res.body.inviteLink, /invitado=/);
});

test('an invalid number never reaches the phone network', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent
    .post('/api/calls/invite')
    .set('Authorization', `Bearer ${token}`)
    .send({ phone: '123' });

  assert.equal(res.status, 400);
});

test('the TwiML endpoint refuses a request without a valid Twilio signature', async () => {
  const agent = app();

  const res = await agent.post('/api/calls/twiml').send({ To: '+34600111222' });

  // Sin firma válida este endpoint permitiría marcar cualquier número a
  // nuestra costa, así que debe rechazarse siempre.
  assert.equal(res.status, 403);
});

test('a voice token is not minted without the full provider configuration', () => {
  // El servicio exige API Key, secreto y TwiML App además del auth token: sin
  // todos, el token sería inservible y es mejor fallar aquí.
  assert.equal(voiceService.isConfigured(), false);
  assert.throws(() => voiceService.createVoiceToken('user-1'), /no está configurada/i);
});
