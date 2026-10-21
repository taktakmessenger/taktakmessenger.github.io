const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function createVideo(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: overrides.title || 'Mi primer video',
      videoUrl: overrides.videoUrl || 'https://cdn.example.com/v/1.mp4',
      description: overrides.description,
    });
  return res;
}

test('authenticated user can upload a video', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await createVideo(agent, user.token);

  assert.equal(res.status, 201);
  assert.equal(res.body.video.title, 'Mi primer video');
  assert.equal(res.body.video.creator, user.user.id);
});

test('upload requires authentication', async () => {
  const agent = app();
  const res = await agent
    .post('/api/videos')
    .send({ title: 'x', videoUrl: 'https://cdn.example.com/v.mp4' });
  assert.equal(res.status, 401);
});

test('upload validates the video URL', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await createVideo(agent, user.token, { videoUrl: 'not-a-url' });
  assert.equal(res.status, 400);
});

test('feed lists videos newest first and paginates', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await createVideo(agent, user.token, { title: 'A' });
  await createVideo(agent, user.token, { title: 'B' });

  const page1 = await agent.get('/api/videos?limit=1');
  assert.equal(page1.status, 200);
  assert.equal(page1.body.videos.length, 1);
  assert.ok(page1.body.nextCursor);

  const page2 = await agent.get(`/api/videos?limit=1&cursor=${page1.body.nextCursor}`);
  assert.equal(page2.body.videos.length, 1);
  assert.notEqual(page1.body.videos[0]._id, page2.body.videos[0]._id);
});

test('viewing a video increments its view counter', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const created = await createVideo(agent, user.token);
  const id = created.body.video._id;

  await agent.get(`/api/videos/${id}`);
  const res = await agent.get(`/api/videos/${id}`);
  assert.equal(res.body.video.views, 2);
});

test('liking a video increments likes and the creator stat', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const viewer = await registerUser(agent);
  const created = await createVideo(agent, creator.token);
  const id = created.body.video._id;

  const res = await agent
    .post(`/api/videos/${id}/like`)
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.likes, 1);

  const profile = await agent.get(`/api/users/${creator.username}`);
  assert.equal(profile.body.user.stats.totalLikes, 1);
});

test('only the owner or an admin can delete a video', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const other = await registerUser(agent);
  const created = await createVideo(agent, owner.token);
  const id = created.body.video._id;

  const denied = await agent
    .delete(`/api/videos/${id}`)
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(denied.status, 403);

  const allowed = await agent
    .delete(`/api/videos/${id}`)
    .set('Authorization', `Bearer ${owner.token}`);
  assert.equal(allowed.status, 200);
});

test('retranscode requires authentication', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const created = await createVideo(agent, user.token);
  const res = await agent.post(`/api/videos/${created.body.video._id}/retranscode`);
  assert.equal(res.status, 401);
});

test('only the owner or an admin can retranscode a video', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const other = await registerUser(agent);
  const created = await createVideo(agent, owner.token);
  const res = await agent
    .post(`/api/videos/${created.body.video._id}/retranscode`)
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(res.status, 403);
});

test('retranscode reports 503 when ffmpeg is unavailable', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const created = await createVideo(agent, user.token);
  const res = await agent
    .post(`/api/videos/${created.body.video._id}/retranscode`)
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(res.status, 503);
  assert.match(res.body.error, /ffmpeg|conversión/i);
});

test('status endpoint reports transcode state without counting a view', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const created = await createVideo(agent, user.token);
  const id = created.body.video._id;

  const res = await agent
    .get(`/api/videos/${id}/status`)
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(res.status, 200);
  assert.ok('transcodeStatus' in res.body);

  // A `GET /:id` would have bumped the view counter; the status probe must not,
  // or letting the creator watch their own upload would inflate its analytics.
  const detail = await agent.get(`/api/videos/${id}`);
  assert.equal(detail.body.video.views, 1);
});

test('status endpoint hides the failure detail from non-owners', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const other = await registerUser(agent);
  const created = await createVideo(agent, owner.token);
  const id = created.body.video._id;

  const Video = require('../src/models/Video');
  await Video.updateOne(
    { _id: id },
    { transcodeStatus: 'failed', transcodeError: 'ffmpeg explotó' }
  );

  const asOther = await agent
    .get(`/api/videos/${id}/status`)
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(asOther.body.transcodeError, null);

  const asOwner = await agent
    .get(`/api/videos/${id}/status`)
    .set('Authorization', `Bearer ${owner.token}`);
  assert.equal(asOwner.body.transcodeStatus, 'failed');
  assert.match(asOwner.body.transcodeError, /ffmpeg/);
});

test('follow is idempotent', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  await agent.post(`/api/users/${b.username}/follow`).set('Authorization', `Bearer ${a.token}`);
  await agent.post(`/api/users/${b.username}/follow`).set('Authorization', `Bearer ${a.token}`);

  const profile = await agent.get(`/api/users/${b.username}`);
  assert.equal(profile.body.user.profile.followers.length, 1);

  await agent.delete(`/api/users/${b.username}/follow`).set('Authorization', `Bearer ${a.token}`);
  const after = await agent.get(`/api/users/${b.username}`);
  assert.equal(after.body.user.profile.followers.length, 0);
});
