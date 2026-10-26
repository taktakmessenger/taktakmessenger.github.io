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

async function makeVideo(creatorId, overrides = {}) {
  return Video.create({
    title: 'Vídeo',
    videoUrl: '/uploads/v.mp4',
    creator: creatorId,
    moderationStatus: 'approved',
    ...overrides,
  });
}

test('compartir sube el contador del vídeo', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await makeVideo(user.user.id);

  assert.equal(video.shares, 0);

  const res = await agent
    .post(`/api/videos/${video._id}/share`)
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.shares, 1);
  assert.equal(res.body.shared, true);

  const stored = await Video.findById(video._id);
  assert.equal(stored.shares, 1);
});

test('compartir dos veces cuenta una sola vez', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await makeVideo(user.user.id);

  const first = await agent
    .post(`/api/videos/${video._id}/share`)
    .set('Authorization', `Bearer ${user.token}`);
  const second = await agent
    .post(`/api/videos/${video._id}/share`)
    .set('Authorization', `Bearer ${user.token}`);

  // Un doble toque en el botón no puede inflar el ranking.
  assert.equal(first.body.shares, 1);
  assert.equal(second.body.shares, 1);

  const stored = await Video.findById(video._id);
  assert.equal(stored.shares, 1);
  assert.equal(stored.sharedBy.length, 1);
});

test('dos personas distintas suman dos compartidos', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const video = await makeVideo(ana.user.id);

  await agent.post(`/api/videos/${video._id}/share`).set('Authorization', `Bearer ${ana.token}`);
  const second = await agent
    .post(`/api/videos/${video._id}/share`)
    .set('Authorization', `Bearer ${beto.token}`);

  assert.equal(second.body.shares, 2);
});

test('compartir exige sesión', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await makeVideo(user.user.id);

  const res = await agent.post(`/api/videos/${video._id}/share`);
  assert.equal(res.status, 401);
});

test('compartir un vídeo inexistente da 404 y no inventa contador', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .post('/api/videos/64b7f0f0f0f0f0f0f0f0f0f0/share')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(res.status, 404);
});

test('el contador no se puede inflar por la puerta del cliente', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const video = await makeVideo(user.user.id);

  // El cuerpo se ignora: el servidor cuenta por `sharedBy`, no por lo que le
  // manden. Un `shares: 9999` en el payload no debe tener efecto.
  await agent
    .post(`/api/videos/${video._id}/share`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ shares: 9999 });

  const stored = await Video.findById(video._id);
  assert.equal(stored.shares, 1);
});
