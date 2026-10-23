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
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// The welcome bonus used to be paid coins, so N free accounts could each gift
// their bonus to one account, which then withdrew real money the platform never
// received. These tests pin the fix: free coins recirculate as free coins.

test('the welcome bonus is promotional, not withdrawable money', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(wallet.body.bonusCoins, 100);
  assert.equal(wallet.body.coins, 0);
  assert.equal(wallet.body.diamonds, 0);
  assert.equal(wallet.body.spendable, 100); // se puede gastar en regalos
});

test('a gift paid with the welcome bonus never becomes withdrawable Diamonds', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  // El receptor empieza sin nada, para medir solo lo que llega del regalo.
  await setWallet(recipient.user.id, { ttcC: 0, bonusC: 0, ttcR: 0 });

  // The sender only has the free bonus.
  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 100 });

  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.paidGift, false);
  assert.equal(res.body.transaction.creatorTtcR, 0);
  assert.equal(res.body.transaction.creatorBonusC, 60);

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${recipient.token}`);
  assert.equal(wallet.body.diamonds, 0, 'no se puede retirar nada');
  assert.equal(wallet.body.bonusCoins, 60, 'el regalo recircula como bono');

  // Nothing withdrawable was created anywhere.
  const withdrawable = await User.find({ 'wallet.ttcR': { $gt: 0 } });
  assert.equal(withdrawable.length, 0);
});

test('the bonus cut of a promotional gift is not counted as revenue', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);

  await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 100 });

  // No real `platform` entry exists; the cut is booked as `platform_bonus`.
  assert.equal(await Transaction.countDocuments({ type: 'platform' }), 0);
  assert.equal(await Transaction.countDocuments({ type: 'platform_bonus' }), 1);

  const admin = await User.create({
    username: 'boss2',
    email: 'boss2@example.com',
    password: 'secret123',
    role: 'admin',
  });
  const { signToken } = require('../src/utils/tokens');
  const res = await agent
    .get('/api/admin/stats')
    .set('Authorization', `Bearer ${signToken(admin)}`);

  assert.equal(res.body.platformEarnings, 0, 'ingresos reales: cero');
});

test('a paid gift still credits withdrawable Diamonds', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 100 });

  assert.equal(res.body.transaction.paidGift, true);
  assert.equal(res.body.transaction.creatorTtcR, 60);

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${recipient.token}`);
  assert.equal(wallet.body.diamonds, 60);
});

test('paid coins are spent before the bonus, so a paying user is never downgraded', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  // 50 paid + 100 bonus. A 40 gift must come entirely from the paid coins.
  await setWallet(sender.user.id, { ttcC: 50, bonusC: 100 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 40 });

  assert.equal(res.body.transaction.paidGift, true);
  assert.equal(res.body.transaction.creatorTtcR, 24); // 60% de 40, retirable
  assert.equal(res.body.remainingCoins, 10);
  assert.equal(res.body.remainingBonusCoins, 100, 'el bono sigue intacto');

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${recipient.token}`);
  assert.equal(wallet.body.diamonds, 24);
});

test('a mixed gift splits the creator share between cashable and promotional', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  // 30 paid + 70 bonus. A 100 gift uses all paid coins and 70 bonus.
  await setWallet(sender.user.id, { ttcC: 30, bonusC: 70 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 100 });

  // Creator share is 60; 30% of the gift was paid, so 18 Diamonds + 42 bonus.
  assert.equal(res.body.transaction.creatorAmount, 60);
  assert.equal(res.body.transaction.creatorTtcR, 18);
  assert.equal(res.body.transaction.creatorBonusC, 42);
  assert.equal(res.body.transaction.creatorTtcR + res.body.transaction.creatorBonusC, 60);
});

test('an admin credit lands in the promotional bucket unless asked otherwise', async () => {
  const agent = app();
  const target = await registerUser(agent);
  const admin = await User.create({
    username: 'boss3',
    email: 'boss3@example.com',
    password: 'secret123',
    role: 'admin',
  });
  const { signToken } = require('../src/utils/tokens');

  const res = await agent
    .post(`/api/admin/users/${target.user.id}/credit`)
    .set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ amount: 500 });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.wallet.bonusC, 600); // 100 de bono + 500
  assert.equal(res.body.user.wallet.ttcC, 0);

  // The adjustment is on the ledger, so it can never be minted invisibly.
  const entry = await Transaction.findOne({ type: 'bonus' });
  assert.equal(entry.amount, 500);
});

test('a cash-out from a pure bonus loop yields nothing', async () => {
  const agent = app();
  const farmer = await registerUser(agent);
  const mule = await registerUser(agent);
  await setWallet(mule.user.id, { ttcC: 0, bonusC: 0, ttcR: 0 });

  // Ten free accounts gift their whole bonus to the mule.
  for (let i = 0; i < 10; i += 1) {
    const account = await registerUser(agent);
    const res = await agent
      .post('/api/wallet/gift')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ recipientId: mule.user.id, amount: 100 });
    assert.equal(res.status, 200);
  }

  const muleWallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${mule.token}`);
  assert.equal(muleWallet.body.diamonds, 0, '600 de bono recibido, cero retirable');
  assert.equal(muleWallet.body.bonusCoins, 600);

  // The farmer cannot withdraw anything either.
  const res = await agent
    .post('/api/wallet/withdraw')
    .set('Authorization', `Bearer ${farmer.token}`)
    .send({ amount: 10, method: 'paypal', details: 'x@example.com' });
  assert.equal(res.status, 400);
});
