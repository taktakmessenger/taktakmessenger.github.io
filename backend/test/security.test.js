const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const User = require('../src/models/User');
const Video = require('../src/models/Video');
const NewsSource = require('../src/models/NewsSource');
const { signToken } = require('../src/utils/tokens');
const newsService = require('../src/services/newsService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function makeAdmin() {
  const admin = await User.create({
    username: `boss_${Math.random().toString(36).slice(2, 7)}`,
    email: `boss_${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'secret123',
    role: 'admin',
  });
  return { user: admin, token: signToken(admin) };
}

async function upload(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Video',
      videoUrl: 'https://cdn.example.com/v.mp4',
      ...overrides,
    });
  return res;
}

// --- Age verification -------------------------------------------------------

test('a new account starts unverified and cannot see adult content', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .get('/api/verification/age')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'unverified');
});

test('age verification endpoints require a session', async () => {
  const agent = app();
  assert.equal((await agent.get('/api/verification/age')).status, 401);
  assert.equal((await agent.post('/api/verification/age/start')).status, 401);
});

test('starting verification moves the account to pending, not verified', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const start = await agent
    .post('/api/verification/age/start')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.status, 'pending');

  // The dev provider never decides on its own: polling stays pending, which is
  // exactly the property that makes it safe as a stand-in.
  const refresh = await agent
    .post('/api/verification/age/refresh')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(refresh.body.status, 'pending');
});

test('a self-declared birth date does not grant adult status', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .put('/api/verification/age/declaration')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ dateOfBirth: '1990-01-01' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'unverified', 'a declaration must not verify anyone');

  const dbUser = await User.findById(user.user.id).select('+dateOfBirth');
  assert.ok(dbUser.dateOfBirth, 'the declaration is still recorded');
});

test('a future birth date is rejected', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const future = new Date(Date.now() + 86_400_000).toISOString();

  const res = await agent
    .put('/api/verification/age/declaration')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ dateOfBirth: future });

  assert.equal(res.status, 400);
});

test('date of birth is never serialised in the ordinary user payload', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await User.updateOne({ _id: user.user.id }, { $set: { dateOfBirth: new Date('1990-01-01') } });

  const res = await agent
    .get('/api/users/me')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.user.dateOfBirth, undefined, 'birth date must stay private');
});

test('an admin can grant age verification and it unlocks adult content', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const admin = await makeAdmin();

  const res = await agent
    .patch(`/api/admin/age-verifications/${user.user.id}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ status: 'verified' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const state = await agent
    .get('/api/verification/age')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(state.body.status, 'verified');

  const dbUser = await User.findById(user.user.id);
  assert.equal(dbUser.ageVerification.method, 'admin', 'a manual grant is attributable');
});

test('age verification admin routes reject a normal user', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .patch(`/api/admin/age-verifications/${user.user.id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ status: 'verified' });

  assert.equal(res.status, 403);
});

// --- NSFW gating ------------------------------------------------------------

test('adult videos are withheld from the feed for unverified viewers', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const viewer = await registerUser(agent);

  await User.updateOne(
    { _id: creator.user.id },
    { $set: { 'ageVerification.status': 'verified', 'ageVerification.method': 'admin' } }
  );

  const nsfw = await upload(agent, creator.token, { title: 'NSFW', isNSFW: true });
  assert.equal(nsfw.status, 201, JSON.stringify(nsfw.body));

  const feed = await agent
    .get('/api/feed/for-you')
    .set('Authorization', `Bearer ${viewer.token}`);

  assert.equal(
    feed.body.videos.some((v) => v._id === nsfw.body.video._id),
    false,
    'an unverified viewer must not be shown adult content'
  );
});

test('adult videos are withheld from anonymous visitors', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  await User.updateOne(
    { _id: creator.user.id },
    { $set: { 'ageVerification.status': 'verified' } }
  );
  const nsfw = await upload(agent, creator.token, { isNSFW: true });

  const list = await agent.get('/api/videos');
  assert.equal(list.body.videos.some((v) => v._id === nsfw.body.video._id), false);

  const single = await agent.get(`/api/videos/${nsfw.body.video._id}`);
  assert.equal(single.status, 404, 'existence must not be confirmed');
});

test('a verified viewer does receive adult videos', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const viewer = await registerUser(agent);

  for (const id of [creator.user.id, viewer.user.id]) {
    await User.updateOne({ _id: id }, { $set: { 'ageVerification.status': 'verified' } });
  }

  const nsfw = await upload(agent, creator.token, { isNSFW: true });

  const feed = await agent
    .get('/api/feed/for-you')
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.ok(feed.body.videos.some((v) => v._id === nsfw.body.video._id));

  const single = await agent
    .get(`/api/videos/${nsfw.body.video._id}`)
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.equal(single.status, 200);
});

test('an unverified creator cannot publish adult content', async () => {
  const agent = app();
  const creator = await registerUser(agent);

  const res = await upload(agent, creator.token, { isNSFW: true });
  assert.equal(res.status, 403);
});

test('a creator keeps access to their own adult video', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  await User.updateOne(
    { _id: creator.user.id },
    { $set: { 'ageVerification.status': 'verified' } }
  );
  const nsfw = await upload(agent, creator.token, { isNSFW: true });

  // Even if verification is later revoked, the uploader must not lose their own
  // footage.
  await User.updateOne({ _id: creator.user.id }, { $set: { 'ageVerification.status': 'rejected' } });

  const res = await agent
    .get(`/api/videos/${nsfw.body.video._id}`)
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(res.status, 200);
});

test('the badge and view counter cannot be forged through the upload body', async () => {
  const agent = app();
  const creator = await registerUser(agent);

  const res = await upload(agent, creator.token, {
    newsVerified: true,
    views: 99999,
    likes: 5000,
    moderationStatus: 'approved',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.video.newsVerified, false);
  assert.equal(res.body.video.views, 0);
  assert.equal(res.body.video.likes, 0);
});

// --- News verification ------------------------------------------------------

test('domain matching accepts subdomains but not lookalikes', () => {
  const source = { domains: ['bbc.com'] };
  assert.equal(newsService.domainMatches(source, 'https://bbc.com/news'), true);
  assert.equal(newsService.domainMatches(source, 'https://www.bbc.com/news'), true);
  assert.equal(newsService.domainMatches(source, 'https://news.bbc.com/x'), true);
  assert.equal(newsService.domainMatches(source, 'https://bbc.com.evil.test/x'), false);
  assert.equal(newsService.domainMatches(source, 'https://evilbbc.com/x'), false);
  assert.equal(newsService.domainMatches(source, 'not a url'), false);
});

test('a video cannot claim an unverified source', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const source = await NewsSource.create({ name: 'Diario', domains: ['diario.test'] });

  const res = await upload(agent, creator.token, {
    newsSource: source._id,
    sourceUrl: 'https://diario.test/nota',
  });
  assert.equal(res.status, 400, 'an unverified source must be rejected at upload');
});

test('a claim whose link points elsewhere is rejected', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const source = await NewsSource.create({
    name: 'Diario',
    domains: ['diario.test'],
    status: 'verified',
  });

  const res = await upload(agent, creator.token, {
    newsSource: source._id,
    sourceUrl: 'https://otro-sitio.test/nota',
  });
  assert.equal(res.status, 400);
});

test('a coherent claim still needs an admin to earn the badge', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const admin = await makeAdmin();
  const source = await NewsSource.create({
    name: 'Diario',
    domains: ['diario.test'],
    status: 'verified',
  });

  const uploadRes = await upload(agent, creator.token, {
    newsSource: source._id,
    sourceUrl: 'https://diario.test/nota',
  });
  assert.equal(uploadRes.status, 201, JSON.stringify(uploadRes.body));
  assert.equal(uploadRes.body.video.newsVerified, false, 'uploading must not grant the badge');

  const approve = await agent
    .post(`/api/admin/news-claims/${uploadRes.body.video._id}/approve`)
    .set('Authorization', `Bearer ${admin.token}`);
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.video.newsVerified, true);
});

test('revoking a source strips the badge from published videos', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const admin = await makeAdmin();
  const source = await NewsSource.create({
    name: 'Diario',
    domains: ['diario.test'],
    status: 'verified',
  });

  const uploadRes = await upload(agent, creator.token, {
    newsSource: source._id,
    sourceUrl: 'https://diario.test/nota',
  });
  await agent
    .post(`/api/admin/news-claims/${uploadRes.body.video._id}/approve`)
    .set('Authorization', `Bearer ${admin.token}`);

  const revoke = await agent
    .patch(`/api/admin/news-sources/${source._id}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ status: 'revoked' });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.body));

  const video = await Video.findById(uploadRes.body.video._id);
  assert.equal(video.newsVerified, false, 'a revoked outlet must not keep its badge');
});

test('granting the badge re-validates a claim that has gone stale', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const admin = await makeAdmin();
  const source = await NewsSource.create({
    name: 'Diario',
    domains: ['diario.test'],
    status: 'verified',
  });

  const uploadRes = await upload(agent, creator.token, {
    newsSource: source._id,
    sourceUrl: 'https://diario.test/nota',
  });

  // The source is revoked between upload and review.
  await NewsSource.updateOne({ _id: source._id }, { $set: { status: 'revoked' } });

  const approve = await agent
    .post(`/api/admin/news-claims/${uploadRes.body.video._id}/approve`)
    .set('Authorization', `Bearer ${admin.token}`);
  assert.equal(approve.status, 400, 'the badge must not be granted on a stale claim');
});

test('news admin routes reject a normal user', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .get('/api/admin/news-sources')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(res.status, 403);
});

// --- Multipart upload gates -------------------------------------------------

// A one-byte body is enough: the route checks the gates before it looks at the
// file, so the assertions do not depend on a real video.
async function uploadFile(agent, token, fields = {}) {
  let req = agent
    .post('/api/videos/upload')
    .set('Authorization', `Bearer ${token}`)
    .attach('video', Buffer.from('x'), 'clip.mp4');

  for (const [key, value] of Object.entries(fields)) {
    req = req.field(key, value);
  }
  return req;
}

test('the multipart upload path enforces the age gate too', async () => {
  const agent = app();
  const creator = await registerUser(agent);

  const res = await uploadFile(agent, creator.token, {
    title: 'Clip',
    isNSFW: 'true',
  });
  assert.equal(res.status, 403, 'the file path must not bypass the NSFW gate');
});

test('a verified creator may upload adult content as multipart', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  await User.updateOne(
    { _id: creator.user.id },
    { $set: { 'ageVerification.status': 'verified' } }
  );

  const res = await uploadFile(agent, creator.token, {
    title: 'Clip',
    isNSFW: 'true',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.video.isNSFW, true);
});

test('the multipart path rejects an incoherent news claim', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const source = await NewsSource.create({
    name: 'Diario',
    domains: ['diario.test'],
    status: 'verified',
  });

  const res = await uploadFile(agent, creator.token, {
    title: 'Clip',
    newsSource: String(source._id),
    sourceUrl: 'https://otro.test/nota',
  });
  assert.equal(res.status, 400);
});

test('an invalid NSFW flag is rejected rather than silently ignored', async () => {
  const agent = app();
  const creator = await registerUser(agent);

  const res = await uploadFile(agent, creator.token, {
    title: 'Clip',
    isNSFW: 'quizá',
  });
  assert.equal(res.status, 400);
});

// --- Proposing news sources -------------------------------------------------

test('a user can propose a news source, but it starts unverified', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .post('/api/verification/news-sources')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name: 'Diario Nuevo', domains: ['nuevo.test'] });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.source.status, 'pending');

  // A pending source is invisible to creators and unusable in a claim.
  const listed = await agent.get('/api/videos/news-sources');
  assert.equal(listed.body.sources.length, 0);
});

test('proposing a source requires a session', async () => {
  const agent = app();
  const res = await agent
    .post('/api/verification/news-sources')
    .send({ name: 'Diario Nuevo', domains: ['nuevo.test'] });
  assert.equal(res.status, 401);
});

test('a proposed source cannot be verified without an admin', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const created = await agent
    .post('/api/verification/news-sources')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name: 'Diario Nuevo', domains: ['nuevo.test'] });

  const res = await agent
    .patch(`/api/admin/news-sources/${created.body.source._id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ status: 'verified' });
  assert.equal(res.status, 403);
});
