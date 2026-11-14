const test = require('node:test');
const assert = require('node:assert/strict');
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
const ManualOrder = require('../src/models/ManualOrder');
const { signToken } = require('../src/utils/tokens');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

const METHODS = [
  { id: 'usdt-bep20', label: 'USDT (BNB Smart Chain)', details: 'Envía USDT por BEP20 y pega el hash.' },
];

// El cobro manual se configura en runtime en los tests, igual que hacen los de
// pagos con las claves de Stripe. Sin métodos, la tienda no lo ofrece.
function withManualMethods(methods = METHODS) {
  const original = env.manualPaymentMethods;
  env.manualPaymentMethods = methods;
  return () => {
    env.manualPaymentMethods = original;
  };
}

async function makeAdmin(username) {
  const admin = await User.create({
    username,
    email: `${username}@example.com`,
    password: 'secret123',
    role: 'admin',
  });
  return { admin, token: signToken(admin) };
}

async function createOrder(agent, token, overrides = {}) {
  return agent
    .post('/api/payments/manual/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      packageId: 'starter',
      method: 'usdt-bep20',
      reference: 'REF-123456',
      ...overrides,
    });
}

test('sin métodos configurados la tienda no ofrece cobro manual', async () => {
  const agent = app();
  const res = await agent.get('/api/payments/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.providers.manual, false);
  assert.deepEqual(res.body.manualMethods, []);
});

test('con métodos configurados la tienda los publica', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const res = await agent.get('/api/payments/config');

    assert.equal(res.body.providers.manual, true);
    assert.equal(res.body.manualMethods[0].id, 'usdt-bep20');
    assert.equal(res.body.manualMethods[0].label, 'USDT (BNB Smart Chain)');
    assert.equal(res.body.manualMethods[0].details, 'Envía USDT por BEP20 y pega el hash.');
  } finally {
    restore();
  }
});

test('la tienda publica la billetera con moneda y red', async () => {
  const restore = withManualMethods([
    { id: 'usdt-trc20', label: 'USDT', payTo: 'TXk9abc', asset: 'USDT', network: 'TRC20' },
  ]);
  try {
    const agent = app();
    const res = await agent.get('/api/payments/config');

    assert.equal(res.body.providers.manual, true);
    assert.equal(res.body.manualMethods[0].asset, 'USDT');
    assert.equal(res.body.manualMethods[0].network, 'TRC20');
    assert.equal(res.body.manualMethods[0].payTo, 'TXk9abc');
  } finally {
    restore();
  }
});

test('la tienda publica el enlace de pago del método', async () => {
  const restore = withManualMethods([
    { id: 'pago-link', label: 'Pago con enlace', link: 'https://example.com/pagar', details: 'Paga y pega la operación.' },
  ]);
  try {
    const agent = app();
    const res = await agent.get('/api/payments/config');

    assert.equal(res.body.manualMethods[0].link, 'https://example.com/pagar');
  } finally {
    restore();
  }
});

test('crear una orden exige sesión', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const res = await agent
      .post('/api/payments/manual/orders')
      .send({ packageId: 'starter', method: 'usdt-bep20', reference: 'REF-1' });

    assert.equal(res.status, 401);
  } finally {
    restore();
  }
});

test('una orden congela el precio y las monedas del catálogo', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await createOrder(agent, user.token);

    assert.equal(res.status, 201);
    assert.equal(res.body.order.coins, 500);
    assert.equal(res.body.order.priceUsd, 6.99);
    assert.equal(res.body.order.status, 'pending');
  } finally {
    restore();
  }
});

test('un paquete desconocido se rechaza', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await createOrder(agent, user.token, { packageId: 'no-existe' });

    assert.equal(res.status, 400);
  } finally {
    restore();
  }
});

test('un método no configurado se rechaza', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await createOrder(agent, user.token, { method: 'otro' });

    assert.equal(res.status, 400);
  } finally {
    restore();
  }
});

test('una referencia vacía se rechaza', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await createOrder(agent, user.token, { reference: '' });

    assert.equal(res.status, 400);
  } finally {
    restore();
  }
});

test('solo un admin ve la cola de órdenes', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);

    const forbidden = await agent
      .get('/api/admin/manual-orders')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(forbidden.status, 403);

    const { token } = await makeAdmin('boss_manual');
    const allowed = await agent
      .get('/api/admin/manual-orders')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(allowed.status, 200);
  } finally {
    restore();
  }
});

test('aprobar acredita las monedas exactamente una vez', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const created = await createOrder(agent, user.token);
    const orderId = created.body.order._id;

    const { token } = await makeAdmin('boss_approve');

    const approved = await agent
      .post(`/api/admin/manual-orders/${orderId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(approved.status, 200);
    assert.equal(approved.body.coins, 500);
    assert.equal(approved.body.order.status, 'approved');

    // El saldo sube 500 (bono de bienvenida aparte) y queda un asiento de compra.
    const wallet = await agent
      .get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 500);

    const purchase = await Transaction.findOne({ type: 'purchase' });
    assert.equal(purchase.amount, 500);
    assert.equal(purchase.method, 'manual');
    assert.equal(purchase.externalId, `manual_${orderId}`);

    // Aprobar otra vez no vuelve a pagar.
    const again = await agent
      .post(`/api/admin/manual-orders/${orderId}/approve`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(again.status, 409);

    const after = await agent
      .get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(after.body.coins, 500, 'no se acredita dos veces');
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 1);
  } finally {
    restore();
  }
});

test('una orden pagada en TakCoin acredita regalo, no monedas retirables', async () => {
  // El TKC se regala minando: si una compra pagada con él acreditara monedas
  // pagadas (canjeables por Diamantes → dinero real), cualquiera podría minar
  // gratis, "comprar" y retirar. La orden debe abonar `bonusC`, no `ttcC`.
  const restore = withManualMethods([
    { id: 'tkc-polygon', label: 'TakCoin (Polygon)', asset: 'TKC', network: 'POLYGON', payTo: '0xb8ae095350e8b141204b4bd61894be08efed54fc', isTakCoin: true },
  ]);
  try {
    const agent = app();
    const user = await registerUser(agent);
    const created = await agent
      .post('/api/payments/manual/orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packageId: 'starter', method: 'tkc-polygon', reference: 'TKC-123456' });
    assert.equal(created.status, 201);
    assert.equal(created.body.order.takcoin, true);

    const { token } = await makeAdmin('boss_tkc');
    const approved = await agent
      .post(`/api/admin/manual-orders/${created.body.order._id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.coins, 500);

    // El asiento NO es `purchase` (dinero real) sino `purchase_bonus`.
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
    const entry = await Transaction.findOne({ type: 'purchase_bonus' });
    assert.equal(entry.amount, 500);
    assert.equal(entry.externalId, `manual_${created.body.order._id}`);

    // Y el saldo retirable (ttcC) no sube: el regalo no se convierte en dinero.
    const wallet = await agent
      .get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 0, 'no hay monedas pagadas');
    assert.equal(wallet.body.bonusCoins, 600, '100 de bienvenida + 500 de regalo');
  } finally {
    restore();
  }
});

test('rechazar una orden no acredita nada', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const created = await createOrder(agent, user.token);
    const orderId = created.body.order._id;

    const { token } = await makeAdmin('boss_reject');

    const rejected = await agent
      .post(`/api/admin/manual-orders/${orderId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Pago no encontrado' });

    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.order.status, 'rejected');

    const wallet = await agent
      .get('/api/wallet')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 0);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
  } finally {
    restore();
  }
});

test('el asistente sin configurar no propone nada y no aprueba solo', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    await createOrder(agent, user.token);

    const { token } = await makeAdmin('boss_assistant');

    const review = await agent
      .get('/api/admin/manual-orders/review')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(review.status, 200);
    assert.equal(review.body.configured, false);
    assert.deepEqual(review.body.reviewed, []);

    // La aprobación automática está apagada por defecto: no toca la orden.
    const auto = await agent
      .post('/api/admin/manual-orders/auto-approve')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(auto.status, 200);
    assert.equal(auto.body.approved, 0);

    assert.equal(await ManualOrder.countDocuments({ status: 'pending' }), 1);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 0);
  } finally {
    restore();
  }
});

test('el usuario ve el estado de sus propias órdenes', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    await createOrder(agent, user.token);

    const res = await agent
      .get('/api/payments/manual/orders')
      .set('Authorization', `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.orders.length, 1);
    assert.equal(res.body.orders[0].status, 'pending');
  } finally {
    restore();
  }
});

test('la cola se filtra por método y por rango de fechas', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    await createOrder(agent, user.token, { reference: 'REF-A' });
    await createOrder(agent, user.token, { reference: 'REF-B' });

    // Fuera de rango: todo lo anterior a mañana no debe salir si pedimos a partir
    // de una fecha futura.
    const future = new Date(Date.now() + 86400_000).toISOString();
    const empty = await agent
      .get('/api/admin/manual-orders')
      .query({ from: future })
      .set('Authorization', `Bearer ${(await makeAdmin('adminf')).token}`);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.orders.length, 0);

    const all = await agent
      .get('/api/admin/manual-orders')
      .query({ method: 'usdt-bep20' })
      .set('Authorization', `Bearer ${(await makeAdmin('adming')).token}`);
    assert.equal(all.body.orders.length, 2);

    const none = await agent
      .get('/api/admin/manual-orders')
      .query({ method: 'otro-metodo' })
      .set('Authorization', `Bearer ${(await makeAdmin('adminh')).token}`);
    assert.equal(none.body.orders.length, 0);
  } finally {
    restore();
  }
});

test('el resumen de compras cuenta órdenes, monedas y compradores', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const created = await createOrder(agent, user.token);
    const admin = await makeAdmin('adminres');

    await agent
      .post(`/api/admin/manual-orders/${created.body.order._id}/approve`)
      .set('Authorization', `Bearer ${admin.token}`);

    const res = await agent
      .get('/api/admin/manual-orders/summary')
      .query({ status: 'approved' })
      .set('Authorization', `Bearer ${admin.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.ordenes, 1);
    assert.equal(res.body.monedas, 500);
    assert.equal(res.body.usd, 6.99);
    assert.equal(res.body.compradores.length, 1);
    assert.equal(res.body.compradores[0].monedas, 500);
  } finally {
    restore();
  }
});

test('solo un admin ve el resumen de compras', async () => {
  const restore = withManualMethods();
  try {
    const agent = app();
    const user = await registerUser(agent);
    const res = await agent
      .get('/api/admin/manual-orders/summary')
      .set('Authorization', `Bearer ${user.token}`);
    assert.equal(res.status, 403);
  } finally {
    restore();
  }
});
