const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectTestDb, resetDb, disconnectTestDb } = require('./helpers');
const User = require('../src/models/User');
const Video = require('../src/models/Video');
const miningService = require('../src/services/miningService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function makeCreator(username) {
  return User.create({
    username,
    email: `${username}@example.com`,
    password: 'secret123',
  });
}

async function makeVideo(creator, metrics = {}) {
  return Video.create({
    title: 'v',
    videoUrl: 'https://cdn.example.com/v.mp4',
    creator: creator._id,
    moderationStatus: 'approved',
    createdAt: new Date(),
    ...metrics,
  });
}

test('engagement scoring weights metrics and rewards fresh content', () => {
  const now = Date.now();
  const base = { views: 100, likes: 10, comments: 2, shares: 1, gifts: 1 };

  const fresh = miningService.scoreVideo({ ...base, createdAt: new Date(now) }, now);
  const old = miningService.scoreVideo(
    { ...base, createdAt: new Date(now - 3 * 60 * 60 * 1000) },
    now
  );

  assert.equal(old, 100 * 0.1 + 10 * 2 + 2 * 5 + 1 * 10 + 1 * 20);
  assert.equal(fresh, old * 2);
});

test('rewards are split between creators proportional to engagement', async () => {
  const big = await makeCreator('bigcreator');
  const small = await makeCreator('smallcreator');

  await makeVideo(big, { views: 1000 });
  await makeVideo(small, { views: 100 });

  const result = await miningService.distributeRewards();

  assert.equal(result.recipients, 2);

  const bigAfter = await User.findById(big._id);
  const smallAfter = await User.findById(small._id);

  assert.ok(bigAfter.wallet.ttcR > smallAfter.wallet.ttcR);
  // Total credited equals the creator pool (36% of the configured pool).
  const total = bigAfter.wallet.ttcR + smallAfter.wallet.ttcR;
  assert.ok(Math.abs(total - 1000 * 0.36) < 1, `total was ${total}`);
});

test('rejected and out-of-window videos earn nothing', async () => {
  const creator = await makeCreator('quietcreator');
  await makeVideo(creator, { views: 500, moderationStatus: 'rejected' });
  await makeVideo(creator, {
    views: 500,
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  const result = await miningService.distributeRewards();
  assert.equal(result.recipients, 0);
  assert.equal(result.distributed, 0);
});

test('a mining cycle is safe to run when there is no activity', async () => {
  const result = await miningService.distributeRewards();
  assert.deepEqual(result, { distributed: 0, recipients: 0 });
});
