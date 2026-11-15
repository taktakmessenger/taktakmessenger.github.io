const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Transaction = require('../src/models/Transaction');
const assistant = require('../src/services/manualPaymentAssistant');
const manualPaymentService = require('../src/services/manualPaymentService');
const { signToken } = require('../src/utils/tokens');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Servidor falso de la API del asistente. Se apunta `assistantApiBase` a él
// para que el servicio haga el mismo fetch y el mismo parseo que en producción,
// en vez de sustituir la función por un doble. Así se prueba que una respuesta
// envuelta en ```json …``` o un proveedor caído no rompen la revisión.
function startFakeAssistant(responder) {
  return new Promise((resolve) => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
        const { status = 200, content } = responder(calls.length);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, calls, port: server.address().port });
    });
  });
}

function withAssistant(base, extra = {}) {
  const original = {
    key: env.assistantApiKey,
    base: env.assistantApiBase,
    auto: env.manualAutoApprove,
    min: env.manualAutoApproveMinConfidence,
    max: env.manualAutoApproveMaxUsd,
    methods: env.manualPaymentMethods,
  };
  env.assistantApiKey = 'test-key';
  env.assistantApiBase = base;
  Object.assign(env, extra);
  env.manualPaymentMethods = [{ id: 'usdt-bep20', label: 'USDT', details: 'USDT BEP20' }];
  return () => Object.assign(env, {
    assistantApiKey: original.key,
    assistantApiBase: original.base,
    manualAutoApprove: original.auto,
    manualAutoApproveMinConfidence: original.min,
    manualAutoApproveMaxUsd: original.max,
    manualPaymentMethods: original.methods,
  });
}

test('parsea una sugerencia envuelta en un bloque de código', () => {
  const parsed = assistant.parseSuggestion(
    '```json\n{"action":"approve","confidence":0.95,"reason":"Referencia válida"}\n```'
  );
  assert.equal(parsed.action, 'approve');
  assert.equal(parsed.confidence, 0.95);
  assert.equal(parsed.reason, 'Referencia válida');
});

test('una acción desconocida cae a revisar, nunca a aprobar', () => {
  const parsed = assistant.parseSuggestion('{"action":"pagar","confidence":1}');
  assert.equal(parsed.action, 'review');
});

test('una confianza fuera de rango se recorta a 0..1', () => {
  assert.equal(assistant.parseSuggestion('{"action":"approve","confidence":5}').confidence, 1);
  assert.equal(assistant.parseSuggestion('{"action":"approve","confidence":-2}').confidence, 0);
  assert.equal(assistant.parseSuggestion('{"action":"approve"}').confidence, 0);
});

test('una respuesta que no es JSON no produce sugerencia', () => {
  assert.equal(assistant.parseSuggestion('no sé'), null);
  assert.equal(assistant.parseSuggestion(''), null);
});

test('el asistente sin configurar no llama a ningún proveedor', async () => {
  const original = env.assistantApiKey;
  env.assistantApiKey = null;
  try {
    assert.equal(assistant.isConfigured(), false);
    assert.equal(await assistant.suggest({ reference: 'X' }), null);
  } finally {
    env.assistantApiKey = original;
  }
});

test('un proveedor caído devuelve null en vez de tumbar la revisión', async () => {
  const { server, port } = await startFakeAssistant(() => ({ status: 500 }));
  const restore = withAssistant(`http://127.0.0.1:${port}`);
  try {
    const suggestion = await assistant.suggest({ reference: 'X', coins: 500, priceUsd: 6.99 });
    assert.equal(suggestion, null);
  } finally {
    restore();
    server.close();
  }
});

test('la revisión devuelve una propuesta por orden sin mover ninguna', async () => {
  const { server, port } = await startFakeAssistant(() => ({
    content: '{"action":"approve","confidence":0.92,"reason":"Referencia con forma real"}',
  }));
  const restore = withAssistant(`http://127.0.0.1:${port}`);
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent
      .post('/api/payments/manual/orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'starter', method: 'usdt-bep20', reference: 'REF-777' });

    const { configured, reviewed } = await manualPaymentService.reviewPending();
    assert.equal(configured, true);
    assert.equal(reviewed.length, 1);
    assert.equal(reviewed[0].suggestion.action, 'approve');

    // Revisar no acredita nada: sigue pendiente y sin asiento de compra.
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
  } finally {
    restore();
    server.close();
  }
});

test('con la aprobación automática apagada no aprueba aunque el asistente esté seguro', async () => {
  const { server, port } = await startFakeAssistant(() => ({
    content: '{"action":"approve","confidence":1,"reason":"Perfecto"}',
  }));
  const restore = withAssistant(`http://127.0.0.1:${port}`, { manualAutoApprove: false });
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent
      .post('/api/payments/manual/orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'starter', method: 'usdt-bep20', reference: 'REF-888' });

    const result = await manualPaymentService.autoApprovePending();
    assert.equal(result.approved, 0);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
  } finally {
    restore();
    server.close();
  }
});

test('encendida, la aprobación automática acredita y deja rastro', async () => {
  const { server, port } = await startFakeAssistant(() => ({
    content: '{"action":"approve","confidence":0.99,"reason":"Referencia válida"}',
  }));
  const restore = withAssistant(`http://127.0.0.1:${port}`, {
    manualAutoApprove: true,
    manualAutoApproveMinConfidence: 0.9,
    manualAutoApproveMaxUsd: 15,
  });
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent
      .post('/api/payments/manual/orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'starter', method: 'usdt-bep20', reference: 'REF-999' });

    const result = await manualPaymentService.autoApprovePending();
    assert.equal(result.approved, 1);

    const wallet = await agent
      .get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 500);

    const purchase = await Transaction.findOne({ type: 'purchase' });
    assert.equal(purchase.method, 'manual');
  } finally {
    restore();
    server.close();
  }
});

test('la aprobación automática no toca un importe por encima del límite', async () => {
  const { server, port } = await startFakeAssistant(() => ({
    content: '{"action":"approve","confidence":1,"reason":"Perfecto"}',
  }));
  const restore = withAssistant(`http://127.0.0.1:${port}`, {
    manualAutoApprove: true,
    manualAutoApproveMaxUsd: 1,
  });
  try {
    const agent = app();
    const user = await registerUser(agent);
    await agent
      .post('/api/payments/manual/orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'starter', method: 'usdt-bep20', reference: 'REF-000' });

    const result = await manualPaymentService.autoApprovePending();
    assert.equal(result.approved, 0);
    assert.equal(result.skipped, 1);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
  } finally {
    restore();
    server.close();
  }
});

test('una referencia repetida no se aprueba sola', async () => {
  const { server, port } = await startFakeAssistant(() => ({
    content: '{"action":"approve","confidence":1,"reason":"Perfecto"}',
  }));
  const restore = withAssistant(`http://127.0.0.1:${port}`, {
    manualAutoApprove: true,
    manualAutoApproveMaxUsd: 15,
  });
  try {
    const agent = app();
    const user = await registerUser(agent);
    for (let i = 0; i < 2; i += 1) {
      await agent
        .post('/api/payments/manual/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ packageId: 'starter', method: 'usdt-bep20', reference: 'MISMA-REF' });
    }

    const result = await manualPaymentService.autoApprovePending();
    assert.equal(result.approved, 0, 'la referencia repetida es señal de abuso');
    assert.equal(result.skipped, 2);
  } finally {
    restore();
    server.close();
  }
});

test('el endpoint de revisión exige ser admin', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const forbidden = await agent
    .get('/api/admin/manual-orders/review')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(forbidden.status, 403);

  const admin = await User.create({
    username: 'boss_review',
    email: 'boss_review@example.com',
    password: 'secret123',
    role: 'admin',
  });
  const allowed = await agent
    .get('/api/admin/manual-orders/review')
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.configured, false);
});
