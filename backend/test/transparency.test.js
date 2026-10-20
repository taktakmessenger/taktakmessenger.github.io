const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const Video = require('../src/models/Video');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function upload(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Mi video',
      videoUrl: 'https://cdn.example.com/video.mp4',
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.video;
}

test('a clean account reports full visibility and no shadowban', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await upload(agent, user.token, {
    tags: ['baile'],
    thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
  });

  const res = await agent
    .get('/api/health')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.score, 100);
  assert.equal(res.body.visibility, 'alta');
  assert.equal(res.body.shadowban, false);
  assert.equal(res.body.findings.length, 0);
});

test('a rejected video is reported as blocked with its reason', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await upload(agent, user.token, {
    tags: ['x'],
    thumbnailUrl: 'https://cdn.example.com/t.jpg',
  });
  await Video.updateOne({ _id: video._id }, { moderationStatus: 'rejected' });

  const res = await agent
    .get('/api/health')
    .set('Authorization', `Bearer ${user.token}`);

  const blocked = res.body.findings.find((f) => f.rule === 'rejected');
  assert.ok(blocked, 'the rejection must be surfaced explicitly');
  assert.equal(blocked.severity, 'blocked');
  assert.equal(res.body.summary.blocked, 1);
  assert.ok(res.body.score < 100);
});

test('a pending video is reported as limited', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await upload(agent, user.token, {
    tags: ['x'],
    thumbnailUrl: 'https://cdn.example.com/t.jpg',
  });
  await Video.updateOne({ _id: video._id }, { moderationStatus: 'pending' });

  const res = await agent
    .get('/api/health')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.body.summary.limited, 1);
  assert.equal(res.body.findings[0].rule, 'pending_review');
});

test('missing tags and thumbnail are surfaced as actionable tips', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await upload(agent, user.token); // no tags, no thumbnail

  const res = await agent
    .get('/api/health')
    .set('Authorization', `Bearer ${user.token}`);

  const rules = res.body.findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['no_tags', 'no_thumbnail']);
  assert.ok(res.body.findings.every((f) => f.severity === 'tip'));
});

test('the health report only covers the caller\'s own videos', async () => {
  const agent = app();
  const alice = await registerUser(agent);
  const bob = await registerUser(agent);

  const bobsVideo = await upload(agent, bob.token);
  await Video.updateOne({ _id: bobsVideo._id }, { moderationStatus: 'rejected' });

  const res = await agent
    .get('/api/health')
    .set('Authorization', `Bearer ${alice.token}`);

  assert.equal(res.body.summary.videos, 0);
  assert.equal(res.body.findings.length, 0);
});

test('the health panel requires authentication', async () => {
  const agent = app();
  const res = await agent.get('/api/health');
  assert.equal(res.status, 401);
});

test('the creator can export their video cleanly, with no watermark', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await upload(agent, user.token, { title: 'Mi Mejor Video' });

  const res = await agent
    .get(`/api/videos/${video._id}/export`)
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.watermark, false);
  assert.equal(res.body.platformLogo, false);
  assert.equal(res.body.downloadUrl, video.videoUrl);
  assert.match(res.body.filename, /Mi-Mejor-Video/);
  assert.match(res.body.filename, /\.mp4$/);
});

test('another user cannot export someone else\'s video', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const stranger = await registerUser(agent);
  const video = await upload(agent, owner.token);

  const res = await agent
    .get(`/api/videos/${video._id}/export`)
    .set('Authorization', `Bearer ${stranger.token}`);

  assert.equal(res.status, 403);
});

test('clean export requires authentication', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await upload(agent, user.token);

  const res = await agent.get(`/api/videos/${video._id}/export`);
  assert.equal(res.status, 401);
});
