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
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

test('the revenue split is 60% creator / 40% platform', () => {
  assert.equal(env.creatorShare, 0.6);
  assert.equal(env.platformShare, 0.4);
});

test('a gift credits 60% to the creator and books the 40% cut', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);
  // El bono de bienvenida es promocional y se gasta despues de lo comprado, asi
  // que aqui se fija el saldo comprado para probar la via retirable.
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 100, giftName: 'Rosa' });

  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.creatorAmount, 60);
  assert.equal(res.body.transaction.platformAmount, 40);
  assert.equal(res.body.remainingCoins, 0); // started at 100

  // The creator keeps the 60% as withdrawable Diamonds.
  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(wallet.body.diamonds, 60);

  // The platform cut is recorded as its own ledger entry, not lost.
  const platform = await Transaction.findOne({ type: 'platform' });
  assert.equal(platform.amount, 40);
});

test('creator share is floored and the remainder goes to the platform', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 33 });

  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.creatorAmount, 19); // floor(33 * 0.6)
  assert.equal(res.body.transaction.platformAmount, 14); // remainder
  // The two sides must always reconstruct the amount that was debited.
  assert.equal(
    res.body.transaction.creatorAmount + res.body.transaction.platformAmount,
    33
  );
});

test('giftCost and giftName are accepted as an alias for amount', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, giftCost: 20, giftName: 'Corazón' });

  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.amount, 20);
  assert.equal(res.body.transaction.creatorAmount, 12);
  assert.match(res.body.message, /Corazón/);

  const tx = await Transaction.findOne({ type: 'gift' });
  assert.equal(tx.giftName, 'Corazón');
});

test('sending both amount and giftCost is rejected', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 10, giftCost: 10 });

  assert.equal(res.status, 400);
});

test('the wallet exposes both branded and internal bucket names', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.coins, res.body.ttcC);
  assert.equal(res.body.diamonds, res.body.ttcR);
});

test('monetization is open from day one, with no thresholds', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .get('/api/wallet/monetization')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, true);
  assert.deepEqual(res.body.requirements, { minFollowers: 0, minViews: 0, minVideos: 0 });
  assert.equal(res.body.creatorShare, 0.6);
  // A brand new account can already be paid.
  assert.equal(res.body.withdrawable, false);
});

test('platform earnings aggregate the 40% cut across gifts', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 40 });

  const admin = await User.create({
    username: 'boss',
    email: 'boss@example.com',
    password: 'secret123',
    role: 'admin',
  });
  const { signToken } = require('../src/utils/tokens');

  const res = await agent
    .get('/api/admin/stats')
    .set('Authorization', `Bearer ${signToken(admin)}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.platformEarnings, 16); // 40% of 40
  assert.equal(res.body.giftsProcessed, 1);
});
