const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { connectTestDb, resetDb, disconnectTestDb, app } = require('./helpers');
const env = require('../src/config/env');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Servidor falso del Graph API. Se levanta un HTTP real y se apunta
// `env.facebookGraphBase` a él: así la ruta ejercita el mismo código que en
// producción (petición, parámetros, parseo) en vez de sustituir el servicio por
// un doble, que es donde se cuelan los fallos de integración.
function startFakeGraph(behavior = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.endsWith('/debug_token')) {
      if (behavior.debugError) return json(400, { error: { message: 'bad token' } });
      return json(200, {
        data: {
          app_id: behavior.appId ?? env.facebookAppId,
          is_valid: behavior.isValid ?? true,
          user_id: behavior.userId ?? 'fb-user-123',
        },
      });
    }
    if (url.pathname.endsWith('/me')) {
      return json(200, {
        id: behavior.userId ?? 'fb-user-123',
        name: behavior.name ?? 'Ana Facebook',
        email: behavior.email,
        picture: { data: { url: 'https://ejemplo.com/ana.jpg' } },
      });
    }
    return json(404, { error: { message: 'not found' } });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function withFacebookConfig(behavior, run) {
  const fake = await startFakeGraph(behavior);
  const original = {
    id: env.facebookAppId,
    secret: env.facebookAppSecret,
    base: env.facebookGraphBase,
  };
  env.facebookAppId = env.facebookAppId || 'test-app-id';
  env.facebookAppSecret = env.facebookAppSecret || 'test-app-secret';
  env.facebookGraphBase = fake.base;
  try {
    return await run();
  } finally {
    env.facebookAppId = original.id;
    env.facebookAppSecret = original.secret;
    env.facebookGraphBase = original.base;
    await fake.close();
  }
}

test('facebook sign-in is closed when not configured', async () => {
  const agent = app();
  const original = { id: env.facebookAppId, secret: env.facebookAppSecret };
  env.facebookAppId = null;
  env.facebookAppSecret = null;
  try {
    const res = await agent.post('/api/auth/facebook').send({ accessToken: 'cualquiera' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
  } finally {
    env.facebookAppId = original.id;
    env.facebookAppSecret = original.secret;
  }
});

test('an unverified token is rejected', async () => {
  await withFacebookConfig({ isValid: false }, async () => {
    const agent = app();
    const res = await agent.post('/api/auth/facebook').send({ accessToken: 'token' });
    assert.equal(res.status, 401, JSON.stringify(res.body));
  });
});

test('a token issued for another app is rejected', async () => {
  await withFacebookConfig({ appId: 'otra-app' }, async () => {
    const agent = app();
    const res = await agent.post('/api/auth/facebook').send({ accessToken: 'token' });
    assert.equal(res.status, 401, JSON.stringify(res.body));
  });
});

test('a valid token creates an account and returns a session', async () => {
  await withFacebookConfig({ email: 'ana@example.com' }, async () => {
    const agent = app();
    const res = await agent.post('/api/auth/facebook').send({ accessToken: 'token' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'ana@example.com');

    // El mismo token no crea un segundo usuario: se reconoce por facebookId.
    const again = await agent.post('/api/auth/facebook').send({ accessToken: 'token' });
    assert.equal(again.body.user.id, res.body.user.id);
  });
});

test('an existing email account is linked, not duplicated', async () => {
  const agent = app();
  const reg = await agent
    .post('/api/auth/register')
    .send({ username: 'anafb', email: 'ana@example.com', password: 'clave12345' });

  await withFacebookConfig({ email: 'ana@example.com' }, async () => {
    const res = await agent.post('/api/auth/facebook').send({ accessToken: 'token' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.id, reg.body.user.id);
  });
});

test('the providers endpoint reports facebook', async () => {
  const agent = app();
  const res = await agent.get('/api/auth/providers');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.facebook, 'boolean');
});
