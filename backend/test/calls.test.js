const test = require('node:test');
const assert = require('node:assert/strict');
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

test('ice configuration requires a session', async () => {
  const agent = app();
  const res = await agent.get('/api/calls/ice');
  // Las credenciales de TURN permiten retransmitir tráfico por el servidor: no
  // pueden estar al alcance de un visitante anónimo.
  assert.equal(res.status, 401);
});

test('ice configuration always offers STUN so calls work on a simple network', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.get('/api/calls/ice').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.iceServers));
  assert.ok(res.body.iceServers.length > 0);

  const urls = res.body.iceServers.flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [server.urls]
  );
  assert.ok(
    urls.some((url) => String(url).startsWith('stun:')),
    'a STUN server is what lets a peer learn its own public address'
  );
});

test('without TURN the response says so, instead of implying calls cross any network', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.get('/api/calls/ice').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  // El entorno de test no configura TURN, así que la bandera debe reflejarlo.
  assert.equal(res.body.hasTurn, false);
});
