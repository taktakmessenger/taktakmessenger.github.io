const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');
const { seedGifts } = require('../src/services/giftService');
const Video = require('../src/models/Video');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function upload(agent, token) {
  const res = await agent
    .post('/api/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Video de prueba', videoUrl: 'https://cdn.example.com/v.mp4' });
  return res.body.video;
}

// Regression: the routes existed as files but were never mounted in app.js, so
// the whole feed/analytics/gift/sound surface returned 404.
test('the previously orphaned routes are mounted', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const feed = await agent.get('/api/feed/for-you');
  assert.equal(feed.status, 200);
  assert.ok(Array.isArray(feed.body.videos));

  const gifts = await agent.get('/api/gifts');
  assert.equal(gifts.status, 200);

  const sounds = await agent.get('/api/sounds');
  assert.equal(sounds.status, 200);

  const interests = await agent
    .get('/api/feed/interests')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(interests.status, 200);
});

// Regression: three taps from the same user produced likes=3, which also
// inflated the mining payout because `likes` is weighted.
test('liking is idempotent and toggles off on the second tap', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await upload(agent, user.token);

  const first = await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.likes, 1);
  assert.equal(first.body.liked, true);

  // Second tap is an unlike, not a second like.
  const second = await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(second.body.likes, 0);
  assert.equal(second.body.liked, false);

  // Third tap likes again, still exactly one.
  const third = await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(third.body.likes, 1);

  const stored = await Video.findById(video._id);
  assert.equal(stored.likes, 1);
  assert.equal(stored.likedBy.length, 1);
});

test('the creator totalLikes counter tracks the toggle', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const viewer = await registerUser(agent);
  const video = await upload(agent, creator.token);

  await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${viewer.token}`);
  await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${viewer.token}`);

  const me = await agent.get('/api/users/me').set('Authorization', `Bearer ${creator.token}`);
  assert.equal(me.body.user.stats.totalLikes, 0);
});

test('the gift catalogue is seeded with server-side prices', async () => {
  const inserted = await seedGifts();
  assert.ok(inserted > 0);

  const agent = app();
  const res = await agent.get('/api/gifts');
  assert.equal(res.status, 200);
  assert.ok(res.body.gifts.length >= 8);

  const rose = res.body.gifts.find((g) => g.name === 'Rosa');
  assert.equal(rose.coinCost, 1);

  // Re-running the seed must not duplicate or change prices.
  const again = await seedGifts();
  assert.equal(again, 0);
  const after = await agent.get('/api/gifts');
  assert.equal(after.body.gifts.length, res.body.gifts.length);
});

// A gift priced by id must charge the catalogue price, not a client value.
test('a gift bought by id charges the catalogue price', async () => {
  await seedGifts();
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);

  const catalogue = await agent.get('/api/gifts');
  const rocket = catalogue.body.gifts.find((g) => g.name === 'Cohete');

  // Sender starts with 100 coins, so a 100-coin rocket is exactly affordable.
  const res = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, giftId: rocket._id });

  assert.equal(res.status, 200);
  assert.equal(res.body.transaction.amount, 100);
  assert.equal(res.body.remainingCoins, 0);
});
