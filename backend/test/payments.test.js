const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');
const env = require('../src/config/env');
const transcodeService = require('../src/services/transcodeService');
const Transaction = require('../src/models/Transaction');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

test('the coin package catalogue is published with server-side prices', async () => {
  const agent = app();
  const res = await agent.get('/api/payments/packages');

  assert.equal(res.status, 200);
  assert.ok(res.body.packages.length >= 4);
  const mega = res.body.packages.find((p) => p.id === 'mega');
  assert.equal(mega.coins, 7000);
});

// The endpoint must stay shut rather than trust an unauthenticated POST.
test('the webhook is closed while no secret is configured', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = null;
  try {
    const agent = app();
    const res = await agent.post('/api/payments/webhook').send({
      event: 'payment.succeeded',
      userId: '000000000000000000000000',
      packageId: 'mega',
      externalId: 'evt_closed',
    });
    assert.equal(res.status, 503);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

test('a forged signature is rejected and credits nothing', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const res = await agent.post('/api/payments/webhook').send({
      event: 'payment.succeeded',
      userId: user.user.id,
      packageId: 'mega',
      externalId: 'evt_forged',
      signature: 'wrong',
    });

    assert.equal(res.status, 401);
    const wallet = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 100); // starter balance only
  } finally {
    env.paymentWebhookSecret = original;
  }
});

// The whole point of the unique index on externalId: a retried delivery must
// not pay twice.
test('a valid webhook credits the package amount exactly once', async () => {
  const original = env.paymentWebhookSecret;
  env.paymentWebhookSecret = 'test-secret';
  try {
    const agent = app();
    const user = await registerUser(agent);

    const payload = {
      event: 'payment.succeeded',
      userId: user.user.id,
      packageId: 'mega',
      externalId: 'evt_once',
      signature: 'test-secret',
    };

    const first = await agent.post('/api/payments/webhook').send(payload);
    assert.equal(first.status, 200);
    assert.equal(first.body.coins, 7000);

    const retry = await agent.post('/api/payments/webhook').send(payload);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);

    const wallet = await agent.get('/api/wallet').set('Authorization', `Bearer ${user.token}`);
    assert.equal(wallet.body.coins, 7100); // 100 starter + 7000, once

    // The buyer cannot pick a package they did not pay for.
    const forged = await agent.post('/api/payments/webhook').send({
      ...payload,
      externalId: 'evt_unknown',
      packageId: 'not-a-real-pack',
    });
    assert.equal(forged.status, 400);
    assert.equal(await Transaction.countDocuments({ type: 'purchase' }), 1);
  } finally {
    env.paymentWebhookSecret = original;
  }
});

// Transcoding is optional: with it off the upload must still succeed and the
// service must report the original file rather than throwing.
test('transcoding degrades gracefully when disabled', async () => {
  const original = env.transcodeEnabled;
  env.transcodeEnabled = false;
  try {
    assert.equal(await transcodeService.hasFfmpeg(), false);
    assert.equal(
      await transcodeService.processVideoToHLS('/tmp/nope.mp4', '/tmp/out', 'id'),
      null
    );
  } finally {
    env.transcodeEnabled = original;
  }
});
