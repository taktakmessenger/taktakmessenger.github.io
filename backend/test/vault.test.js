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
const vaultService = require('../src/services/vaultService');
const { signToken } = require('../src/utils/tokens');

// Los índices (en particular el único de `externalId`) se construyen en segundo
// plano al primer uso del modelo. Se esperan aquí para que el test de
// idempotencia no corra antes de que exista el índice que está probando.
test.before(async () => {
  await connectTestDb();
  await Promise.all([Transaction.init(), User.init()]);
});
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function makeBuyer() {
  return User.create({
    username: 'comprador_boveda',
    email: 'comprador_boveda@example.com',
    password: 'secret123',
  });
}

async function makeAdmin(username = 'admin_boveda') {
  const admin = await User.create({
    username,
    email: `${username}@example.com`,
    password: 'secret123',
    role: 'admin',
  });
  return { admin, token: signToken(admin) };
}

// --- Reparto 40/60 --------------------------------------------------------

test('el reparto parte cada venta en 40% admin y 60% bóveda', () => {
  assert.deepEqual(vaultService.split(10), { total: 10, admin: 4, vault: 6 });
  assert.deepEqual(vaultService.split(9.99), { total: 9.99, admin: 4, vault: 5.99 });
});

test('el reparto nunca pierde ni inventa céntimos', () => {
  for (const usd of [0.01, 0.05, 1, 7.77, 12.34, 99.99]) {
    const { total, admin, vault } = vaultService.split(usd);
    assert.equal(Math.round((admin + vault) * 100) / 100, total);
  }
});

test('registrar una venta es idempotente por externalId', async () => {
  const buyer = await makeBuyer();
  const first = await vaultService.recordPurchaseRevenue({
    externalId: 'manual_abc',
    priceUsd: 10,
    method: 'manual',
    userId: buyer._id,
  });
  const second = await vaultService.recordPurchaseRevenue({
    externalId: 'manual_abc',
    priceUsd: 10,
    method: 'manual',
    userId: buyer._id,
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);

  // Solo hay un asiento de venta aunque se llame dos veces.
  assert.equal(await Transaction.countDocuments({ type: 'sale_revenue' }), 1);
});

// --- Estado de la bóveda --------------------------------------------------

test('la bóveda resume lo vendido, la ganancia y lo que se debe a los usuarios', async () => {
  const buyer = await makeBuyer();
  await vaultService.recordPurchaseRevenue({ externalId: 'a', priceUsd: 10, userId: buyer._id });
  await vaultService.recordPurchaseRevenue({ externalId: 'b', priceUsd: 20, userId: buyer._id });

  const status = await vaultService.getVaultStatus();
  assert.equal(status.grossSalesUsd, 30);
  assert.equal(status.sales, 2);
  assert.equal(status.adminEarningsUsd, 12); // 40% de 30
  assert.equal(status.vaultOwedUsd, 18); // 60% de 30
  assert.equal(status.network, 'BEP20');
  assert.equal(status.adminAddress, env.crypto.adminAddress);
  assert.equal(status.vaultAddress, env.crypto.vaultAddress);
});

test('los retiros pagados se descuentan de lo que la bóveda debe', async () => {
  const buyer = await makeBuyer();
  await vaultService.recordPurchaseRevenue({ externalId: 'a', priceUsd: 100, userId: buyer._id });

  await Transaction.create({
    from: buyer._id,
    amount: 25,
    type: 'withdraw',
    ttcType: 'ttcR',
    method: 'crypto',
    status: 'completed',
  });

  const status = await vaultService.getVaultStatus();
  assert.equal(status.vaultOwedUsd, 35); // 60 - 25
  assert.equal(status.paidOutDiamonds, 25);
});

// --- Botón de emergencia --------------------------------------------------

test('la transferencia de emergencia exige confirmación explícita', async () => {
  const { token } = await makeAdmin();
  const agent = app();

  const res = await agent
    .post('/api/admin/vault/emergency-transfer')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirm: false });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /confirmación/i);
});

test('la transferencia mueve la ganancia del admin y NO toca el dinero de los usuarios', async () => {
  const { token } = await makeAdmin();
  const agent = app();
  const buyer = await makeBuyer();
  await vaultService.recordPurchaseRevenue({ externalId: 'a', priceUsd: 50, userId: buyer._id });

  const res = await agent
    .post('/api/admin/vault/emergency-transfer')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirm: true });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.movedUsd, 20); // solo el 40%
  assert.equal(res.body.vaultOwedUsd, 30); // el 60% sigue en la bóveda

  // El saldo de los usuarios sigue intacto.
  const status = await vaultService.getVaultStatus();
  assert.equal(status.vaultOwedUsd, 30);
});

test('solo un admin puede ver y operar la bóveda', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const read = await agent
    .get('/api/admin/vault')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(read.status, 403);

  const move = await agent
    .post('/api/admin/vault/emergency-transfer')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ confirm: true });
  assert.equal(move.status, 403);
});

test('el admin ve el estado de la bóveda', async () => {
  const { token } = await makeAdmin();
  const agent = app();
  const buyer = await makeBuyer();
  await vaultService.recordPurchaseRevenue({ externalId: 'a', priceUsd: 10, userId: buyer._id });

  const res = await agent
    .get('/api/admin/vault')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.grossSalesUsd, 10);
  assert.equal(res.body.adminEarningsUsd, 4);
});
