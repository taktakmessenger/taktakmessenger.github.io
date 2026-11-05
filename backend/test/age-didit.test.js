const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');
const env = require('../src/config/env');
const User = require('../src/models/User');

// Un servidor Didit falso. Se levanta HTTP de verdad y se apunta
// `env.diditApiBase` a él, igual que con Stripe y PayPal: así se ejercita el
// mismo código (cabeceras, parseo, mapeo de estados) en vez de sustituir
// funciones por dobles, que es donde se cuelan los fallos de integración.
function startFakeDidit() {
  const calls = { created: [] };
  let decisionStatus = 'Approved';

  const server = http.createServer((req, res) => {
    const url = req.url || '';
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url === '/v3/session/' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        calls.created.push({ body: JSON.parse(raw || '{}'), headers: req.headers });
        json(201, {
          session_id: 'sess-123',
          session_kind: 'user',
          session_number: 1,
          status: 'Not Started',
          url: 'https://verify.didit.me/sess-123',
          vendor_data: JSON.parse(raw || '{}').vendor_data,
        });
      });
      return;
    }

    if (url.startsWith('/v3/session/') && url.endsWith('/decision/')) {
      return json(200, { session_id: 'sess-123', status: decisionStatus });
    }

    return json(404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        calls,
        setDecision: (s) => {
          decisionStatus = s;
        },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function withDiditEnv(fake, overrides = {}) {
  const original = {
    ageProvider: env.ageProvider,
    diditApiBase: env.diditApiBase,
    diditApiKey: env.diditApiKey,
    diditWorkflowId: env.diditWorkflowId,
    diditWebhookSecret: env.diditWebhookSecret,
  };
  env.ageProvider = 'didit';
  env.diditApiBase = fake.base;
  env.diditApiKey = 'test-key';
  env.diditWorkflowId = 'wf-test';
  env.diditWebhookSecret = 'whsec_test';
  Object.assign(env, overrides);
  return () => Object.assign(env, original);
}

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

test('arrancar con Didit devuelve la URL hospedada y deja la cuenta pendiente', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent
      .post('/api/verification/age/start')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.redirectUrl, 'https://verify.didit.me/sess-123');
    assert.equal(res.body.provider, 'didit');

    // El id del usuario viaja como `vendor_data` para poder reconocerlo luego.
    assert.equal(fake.calls.created[0].body.vendor_data, user.user.id);
    assert.equal(fake.calls.created[0].headers['x-api-key'], 'test-key');

    const dbUser = await User.findById(user.user.id).select('+ageVerification.providerRef');
    assert.equal(dbUser.ageVerification.providerRef, 'sess-123');
  } finally {
    restore();
    await fake.close();
  }
});

test('el refresco traduce Approved a verified y sella la fecha', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    fake.setDecision('Approved');
    const res = await agent
      .post('/api/verification/age/refresh')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.body.status, 'verified');
    const dbUser = await User.findById(user.user.id);
    assert.equal(dbUser.ageVerification.status, 'verified');
    assert.equal(dbUser.ageVerification.method, 'document');
    assert.ok(dbUser.ageVerification.verifiedAt);
  } finally {
    restore();
    await fake.close();
  }
});

test('un veredicto Declined no verifica a nadie', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    fake.setDecision('Declined');
    const res = await agent
      .post('/api/verification/age/refresh')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.body.status, 'rejected');
    const dbUser = await User.findById(user.user.id);
    assert.equal(dbUser.isAdult(), false);
  } finally {
    restore();
    await fake.close();
  }
});

test('un estado intermedio se queda en pending, nunca aprueba', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    fake.setDecision('In Review');
    const res = await agent
      .post('/api/verification/age/refresh')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.body.status, 'pending');
  } finally {
    restore();
    await fake.close();
  }
});

test('sin DIDIT_API_KEY el arranque falla cerrado', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake, { diditApiKey: null });
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await agent
      .post('/api/verification/age/start')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(res.status, 503);
  } finally {
    restore();
    await fake.close();
  }
});

test('el webhook con firma válida verifica la cuenta', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    const payload = JSON.stringify({
      session_id: 'sess-123',
      status: 'Approved',
      vendor_data: user.user.id,
    });
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(payload, 'utf8')
      .digest('hex');

    const res = await agent
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(payload);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.applied, true);
    const dbUser = await User.findById(user.user.id);
    assert.equal(dbUser.ageVerification.status, 'verified');
  } finally {
    restore();
    await fake.close();
  }
});

test('el webhook con firma inválida se rechaza y no cambia nada', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    const payload = JSON.stringify({
      session_id: 'sess-123',
      status: 'Approved',
      vendor_data: user.user.id,
    });

    const res = await agent
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'deadbeef')
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(payload);

    assert.equal(res.status, 401);
    const dbUser = await User.findById(user.user.id);
    assert.notEqual(dbUser.ageVerification.status, 'verified');
  } finally {
    restore();
    await fake.close();
  }
});

test('un webhook viejo se rechaza aunque la firma cuadre', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    const payload = JSON.stringify({
      session_id: 'sess-123',
      status: 'Approved',
      vendor_data: user.user.id,
    });
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(payload, 'utf8')
      .digest('hex');

    const res = await agent
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000) - 3600))
      .send(payload);

    assert.equal(res.status, 401);
  } finally {
    restore();
    await fake.close();
  }
});

test('el webhook acepta la firma V2 sobre el JSON canónico', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    // Se envía con las claves desordenadas, pero se firma la versión canónica
    // (claves ordenadas), que es lo que hace Didit.
    const payload = JSON.stringify({
      vendor_data: user.user.id,
      status: 'Approved',
      session_id: 'sess-123',
    });
    const canonical = JSON.stringify({
      session_id: 'sess-123',
      status: 'Approved',
      vendor_data: user.user.id,
    });
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(canonical, 'utf8')
      .digest('hex');

    const res = await agent
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature-V2', signature)
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(payload);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dbUser = await User.findById(user.user.id);
    assert.equal(dbUser.ageVerification.status, 'verified');
  } finally {
    restore();
    await fake.close();
  }
});

test('un webhook para un usuario desconocido no crea nada', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const payload = JSON.stringify({
      session_id: 'sess-xyz',
      status: 'Approved',
      vendor_data: '000000000000000000000000',
    });
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(payload, 'utf8')
      .digest('hex');

    const res = await app()
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.applied, false);
  } finally {
    restore();
    await fake.close();
  }
});

test('un veredicto posterior no le quita la verificación a quien ya la tenía', async () => {
  const fake = await startFakeDidit();
  const restore = withDiditEnv(fake);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent.post('/api/verification/age/start').set('Authorization', `Bearer ${user.token}`);

    // Primero se verifica por webhook…
    const approved = JSON.stringify({ session_id: 'sess-123', status: 'Approved', vendor_data: user.user.id });
    await agent
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', crypto.createHmac('sha256', 'whsec_test').update(approved, 'utf8').digest('hex'))
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(approved);

    // …y después llega un evento de otro estado que no debe degradarla.
    const declined = JSON.stringify({ session_id: 'sess-123', status: 'Declined', vendor_data: user.user.id });
    await agent
      .post('/api/verification/didit/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', crypto.createHmac('sha256', 'whsec_test').update(declined, 'utf8').digest('hex'))
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .send(declined);

    const dbUser = await User.findById(user.user.id);
    assert.equal(dbUser.ageVerification.status, 'verified');
  } finally {
    restore();
    await fake.close();
  }
});
