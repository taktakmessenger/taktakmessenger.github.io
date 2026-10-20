const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function upload(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Video',
      videoUrl: 'https://cdn.example.com/v.mp4',
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.video;
}

test('hiding a creator removes their videos from the feed', async () => {
  const agent = app();
  const viewer = await registerUser(agent);
  const creator = await registerUser(agent);
  const video = await upload(agent, creator.token, { likes: 500 });

  const before = await agent
    .get('/api/feed/for-you')
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.ok(before.body.videos.some((v) => v._id === video._id));

  const hide = await agent
    .post('/api/feed/hide-creator')
    .set('Authorization', `Bearer ${viewer.token}`)
    .send({ creatorId: creator.user.id });
  assert.equal(hide.status, 200);

  const after = await agent
    .get('/api/feed/for-you')
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.ok(
    !after.body.videos.some((v) => v._id === video._id),
    'el creador oculto no debe aparecer en el feed'
  );
});

// Hiding is a preference toggle, not a one-way door.
test('unhiding a creator brings their videos back', async () => {
  const agent = app();
  const viewer = await registerUser(agent);
  const creator = await registerUser(agent);
  const video = await upload(agent, creator.token, { likes: 500 });

  await agent
    .post('/api/feed/hide-creator')
    .set('Authorization', `Bearer ${viewer.token}`)
    .send({ creatorId: creator.user.id });

  const unhide = await agent
    .delete(`/api/feed/hide-creator/${creator.user.id}`)
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.equal(unhide.status, 200);

  const after = await agent
    .get('/api/feed/for-you')
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.ok(after.body.videos.some((v) => v._id === video._id));
});

test('hiding the same creator twice is not an error', async () => {
  const agent = app();
  const viewer = await registerUser(agent);
  const creator = await registerUser(agent);

  const payload = { creatorId: creator.user.id };
  const first = await agent
    .post('/api/feed/hide-creator')
    .set('Authorization', `Bearer ${viewer.token}`)
    .send(payload);
  const second = await agent
    .post('/api/feed/hide-creator')
    .set('Authorization', `Bearer ${viewer.token}`)
    .send(payload);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
});

test('hiding a tag filters videos carrying it', async () => {
  const agent = app();
  const viewer = await registerUser(agent);
  const creator = await registerUser(agent);
  const tagged = await upload(agent, creator.token, { tags: ['baile'], likes: 500 });
  const other = await upload(agent, creator.token, { tags: ['cocina'], likes: 400 });

  await agent
    .post('/api/feed/hide-tag')
    .set('Authorization', `Bearer ${viewer.token}`)
    .send({ tag: 'baile' });

  const after = await agent
    .get('/api/feed/for-you')
    .set('Authorization', `Bearer ${viewer.token}`);

  assert.ok(!after.body.videos.some((v) => v._id === tagged._id));
  assert.ok(after.body.videos.some((v) => v._id === other._id));
});

test('an anonymous viewer cannot hide anything', async () => {
  const agent = app();
  const creator = await registerUser(agent);

  const res = await agent
    .post('/api/feed/hide-creator')
    .send({ creatorId: creator.user.id });
  assert.equal(res.status, 401);
});

test('a malformed creator id is rejected before touching the database', async () => {
  const agent = app();
  const viewer = await registerUser(agent);

  const res = await agent
    .post('/api/feed/hide-creator')
    .set('Authorization', `Bearer ${viewer.token}`)
    .send({ creatorId: 'no-soy-un-id' });

  assert.equal(res.status, 400);
});

// The recommender must not bury a new creator behind one prolific account.
test('one account cannot own an entire feed page', async () => {
  const agent = app();
  const viewer = await registerUser(agent);
  const prolific = await registerUser(agent);
  const newcomer = await registerUser(agent);

  for (let i = 0; i < 8; i += 1) {
    await upload(agent, prolific.token, { likes: 900 - i, tags: ['baile'] });
  }
  const fresh = await upload(agent, newcomer.token, { likes: 1, tags: ['cocina'] });

  const res = await agent
    .get('/api/feed/for-you?limit=6')
    .set('Authorization', `Bearer ${viewer.token}`);

  assert.equal(res.status, 200);
  const fromProlific = res.body.videos.filter(
    (v) => v.creator?._id === prolific.user.id
  ).length;

  assert.ok(fromProlific <= 2, `un creador ocupó ${fromProlific} de 6 puestos`);
  assert.ok(
    res.body.videos.some((v) => v._id === fresh._id),
    'el creador nuevo debe recibir exposición'
  );
});
