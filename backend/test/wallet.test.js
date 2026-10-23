const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser, setWallet } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

test('gift moves TTC-C to the recipient as TTC-R minus the platform share', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 50 });

  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.creatorAmount, 30); // floor(50 * 0.6)
  assert.equal(res.body.transaction.platformAmount, 20); // 40% remainder

  const senderWallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${sender.token}`);
  assert.equal(senderWallet.body.ttcC, 50); // started at 100

  const recipientWallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${recipient.token}`);
  assert.equal(recipientWallet.body.ttcR, 30);
});

test('concurrent gifts cannot overdraw the balance', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  // Sender starts with 100. Fire five concurrent 30-TTC gifts: only three can
  // ever succeed (90 <= 100), regardless of interleaving.
  const attempts = Array.from({ length: 5 }, () =>
    agent
      .post('/api/wallet/gift')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ recipientId: recipient.user.id, amount: 30 })
  );
  const results = await Promise.all(attempts);
  const ok = results.filter((r) => r.status === 200).length;

  assert.equal(ok, 3, `expected exactly 3 successes, got ${ok}`);

  const senderWallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${sender.token}`);
  assert.equal(senderWallet.body.ttcC, 10);
  assert.ok(senderWallet.body.ttcC >= 0, 'balance must never go negative');
});

test('gift is rejected when the sender has insufficient TTC-C', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 1000 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /insuficientes/i);
});

test('gift to self is rejected', async () => {
  const agent = app();
  const sender = await registerUser(agent);

  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: sender.user.id, amount: 10 });

  assert.equal(res.status, 400);
});

test('withdraw debits TTC-R and records a pending transaction', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const recipient = await registerUser(agent);
  await setWallet(sender.user.id, { ttcC: 100, bonusC: 0 });

  await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: recipient.user.id, amount: 100 });

  const res = await agent
    .post('/api/wallet/withdraw')
    .set('Authorization', `Bearer ${recipient.token}`)
    .send({ amount: 30, method: 'paypal', details: 'recipient@example.com' });

  assert.equal(res.status, 200);

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${recipient.token}`);
  assert.equal(wallet.body.ttcR, 30); // 60 credited, 30 withdrawn

  const txs = await agent
    .get('/api/wallet/transactions')
    .set('Authorization', `Bearer ${recipient.token}`);
  const withdraw = txs.body.find((t) => t.type === 'withdraw');
  assert.equal(withdraw.status, 'pending');
});

test('over-withdrawal is rejected', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .post('/api/wallet/withdraw')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ amount: 500, method: 'paypal' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /insuficientes/i);
});

test('wallet endpoints require authentication', async () => {
  const agent = app();
  const res = await agent.get('/api/wallet');
  assert.equal(res.status, 401);
});
