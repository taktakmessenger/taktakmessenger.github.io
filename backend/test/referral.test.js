// Programa de referidos: quién invita cobra cuando su invitado compra.
//
// Se prueba contra un mongod real (no un doble) porque lo que hay que demostrar
// son garantías de la base: el índice único de `externalId` que hace idempotente
// el premio, y que el abono cae en el cubo de regalo y no en el retirable.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
  setWallet,
} = require('./helpers');
const env = require('../src/config/env');
const User = require('../src/models/User');
const Transaction = require('../src/models/Transaction');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// Envía una compra confirmada por el webhook firmado, que es el camino real por
// el que se acreditan monedas.
async function purchase(agent, user, { externalId, packageId = 'starter' }) {
  return agent.post('/api/payments/webhook').send({
    event: 'payment.succeeded',
    userId: user.user.id,
    packageId,
    externalId,
    signature: env.paymentWebhookSecret,
  });
}

test('el registro con código apunta al invitador', async () => {
  const agent = app();
  const inviter = await registerUser(agent);

  const stats = await agent.get('/api/wallet/referral').set(auth(inviter.token));
  assert.equal(stats.status, 200);
  assert.ok(stats.body.code, 'debe generar un código de invitación');

  const invited = await agent
    .post('/api/auth/register')
    .send({
      username: 'invitado_1',
      email: 'invitado_1@example.com',
      password: 'secret123',
      ref: stats.body.code,
    });
  assert.equal(invited.status, 201);

  const stored = await User.findById(invited.body.user.id).select('referral');
  assert.equal(String(stored.referral.referredBy), String(inviter.user.id));
});

test('un código inventado no rompe el registro ni apunta a nadie', async () => {
  const agent = app();
  const invited = await agent
    .post('/api/auth/register')
    .send({
      username: 'sincodigo',
      email: 'sincodigo@example.com',
      password: 'secret123',
      ref: 'NOEXISTE',
    });
  assert.equal(invited.status, 201);

  const stored = await User.findById(invited.body.user.id).select('referral');
  assert.equal(stored.referral.referredBy, null);
});

test('nadie puede invitarse a sí mismo', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const stats = await agent.get('/api/wallet/referral').set(auth(user.token));

  // El código propio existe, pero no puede apuntarse a sí mismo.
  const referralService = require('../src/services/referralService');
  const result = await referralService.attachReferrer({
    userId: user.user.id,
    code: stats.body.code,
  });
  assert.equal(result, null);

  const stored = await User.findById(user.user.id).select('referral');
  assert.equal(stored.referral.referredBy, null);
});

test('una compra del invitado paga el 10% al invitador, en monedas de regalo', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const inviter = await registerUser(agent);
    // A cero para que el bono de bienvenida no se confunda con el premio.
    await setWallet(inviter.user.id, { ttcC: 0, bonusC: 0 });
    const stats = await agent.get('/api/wallet/referral').set(auth(inviter.token));

    const invited = await agent.post('/api/auth/register').send({
      username: 'comprador_1',
      email: 'comprador_1@example.com',
      password: 'secret123',
      ref: stats.body.code,
    });
    const buyer = { user: invited.body.user, token: invited.body.token };

    // Se deja al comprador sin bono para que la compra sea el único movimiento.
    await setWallet(buyer.user.id, { ttcC: 0, bonusC: 0 });

    const starter = env.coinPackages.find((p) => p.id === 'starter');
    const res = await purchase(agent, buyer, { externalId: 'evt_ref_1' });
    assert.equal(res.status, 200);

    // El premio es el 10% de lo pagado, truncado a céntimos: 6,99 $ -> 0,69.
    const expected = Math.floor(Math.round(starter.priceUsd * 100) * 0.1) / 100;
    assert.equal(expected, 0.69); // 10% de 6,99 $, sin fracciones de moneda

    const inviterAfter = await User.findById(inviter.user.id).select('wallet referral');
    // El premio entra como regalo: gastable, no retirable.
    assert.equal(inviterAfter.wallet.bonusC, expected);
    assert.equal(inviterAfter.wallet.ttcC, 0);
    assert.equal(inviterAfter.referral.earnedByReferrer, expected);

    // Y el invitado conserva sus monedas compradas.
    const buyerAfter = await User.findById(buyer.user.id).select('wallet referral');
    assert.equal(buyerAfter.wallet.ttcC, starter.coins);
    assert.equal(buyerAfter.referral.earnedForReferrer, expected);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

test('el premio nunca es retirable: no toca ttcR', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const inviter = await registerUser(agent);
    const stats = await agent.get('/api/wallet/referral').set(auth(inviter.token));
    const invited = await agent.post('/api/auth/register').send({
      username: 'comprador_2',
      email: 'comprador_2@example.com',
      password: 'secret123',
      ref: stats.body.code,
    });
    await purchase(agent, { user: invited.body.user, token: invited.body.token }, {
      externalId: 'evt_ref_2',
    });

    const inviterAfter = await User.findById(inviter.user.id).select('wallet');
    assert.equal(inviterAfter.wallet.ttcR, 0);
    // El retiro solo sale de ttcR, así que con 0 no hay nada que sacar.
    const wallet = await agent.get('/api/wallet').set(auth(inviter.token));
    assert.equal(wallet.body.diamonds, 0);
    assert.ok(wallet.body.bonusCoins > 0);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

test('un webhook reenviado no paga el premio dos veces', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const inviter = await registerUser(agent);
    await setWallet(inviter.user.id, { ttcC: 0, bonusC: 0 });
    const stats = await agent.get('/api/wallet/referral').set(auth(inviter.token));
    const invited = await agent.post('/api/auth/register').send({
      username: 'comprador_3',
      email: 'comprador_3@example.com',
      password: 'secret123',
      ref: stats.body.code,
    });
    const buyer = { user: invited.body.user, token: invited.body.token };

    await purchase(agent, buyer, { externalId: 'evt_dup' });
    await purchase(agent, buyer, { externalId: 'evt_dup' });

    const entries = await Transaction.find({ type: 'referral_bonus' });
    assert.equal(entries.length, 1);

    const inviterAfter = await User.findById(inviter.user.id).select('wallet');
    const starter = env.coinPackages.find((p) => p.id === 'starter');
    assert.equal(inviterAfter.wallet.bonusC, Math.floor(Math.round(starter.priceUsd * 100) * 0.1) / 100);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

test('sin invitador no se paga nada', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const solo = await registerUser(agent);
    await purchase(agent, solo, { externalId: 'evt_solo' });
    assert.equal(await Transaction.countDocuments({ type: 'referral_bonus' }), 0);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

test('el resumen de referidos cuenta invitados y ganancias', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const inviter = await registerUser(agent);
    const first = await agent.get('/api/wallet/referral').set(auth(inviter.token));

    for (const n of [1, 2]) {
      const invited = await agent.post('/api/auth/register').send({
        username: `resumen_${n}`,
        email: `resumen_${n}@example.com`,
        password: 'secret123',
        ref: first.body.code,
      });
      if (n === 1) {
        await purchase(agent, { user: invited.body.user, token: invited.body.token }, {
          externalId: 'evt_resumen',
        });
      }
    }

    const res = await agent.get('/api/wallet/referral').set(auth(inviter.token));
    assert.equal(res.body.invited, 2);
    assert.ok(res.body.earned > 0);
    assert.equal(res.body.withdrawable, false);
    assert.equal(res.body.code, first.body.code);
    assert.ok(res.body.link.includes(first.body.code));
  } finally {
    env.paymentWebhookSecret = original;
  }
});
