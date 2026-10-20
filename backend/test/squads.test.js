const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
} = require('./helpers');
const Squad = require('../src/models/Squad');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function createSquad(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/squads')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Squad de prueba', visibility: 'private', ...overrides });
  if (res.status !== 201) {
    throw new Error(`create squad failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.squad;
}

test('creating a squad makes the creator its owner', async () => {
  const agent = app();
  const owner = await registerUser(agent);

  const squad = await createSquad(agent, owner.token);

  assert.equal(squad.slug, 'squad-de-prueba');
  assert.equal(squad.visibility, 'private');
  assert.ok(squad.voiceRoom, 'a voice room should be provisioned');

  const stored = await Squad.findOne({ slug: squad.slug });
  assert.equal(stored.members.length, 1);
  assert.equal(stored.members[0].role, 'owner');
});

test('the invite code is never returned to clients', async () => {
  const agent = app();
  const owner = await registerUser(agent);

  const squad = await createSquad(agent, owner.token);
  assert.equal(squad.joinCode, undefined);

  const listed = await agent
    .get('/api/squads')
    .set('Authorization', `Bearer ${owner.token}`);
  assert.ok(listed.body.squads.every((s) => s.joinCode === undefined));
});

test('a private squad requires the correct invite code to join', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const outsider = await registerUser(agent);

  const squad = await createSquad(agent, owner.token);
  const stored = await Squad.findOne({ slug: squad.slug }).select('+joinCode');

  const wrong = await agent
    .post(`/api/squads/${squad.slug}/join`)
    .set('Authorization', `Bearer ${outsider.token}`)
    .send({ joinCode: 'not-the-code' });
  assert.equal(wrong.status, 403);

  const right = await agent
    .post(`/api/squads/${squad.slug}/join`)
    .set('Authorization', `Bearer ${outsider.token}`)
    .send({ joinCode: stored.joinCode });
  assert.equal(right.status, 200);
  assert.equal(right.body.joined, true);
  assert.equal(right.body.voiceRoom, squad.voiceRoom);
});

test('a public squad can be joined without an invite code', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const outsider = await registerUser(agent);

  const squad = await createSquad(agent, owner.token, { visibility: 'public' });

  const res = await agent
    .post(`/api/squads/${squad.slug}/join`)
    .set('Authorization', `Bearer ${outsider.token}`)
    .send({});

  assert.equal(res.status, 200);
});

test('joining twice does not duplicate the member', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);

  const squad = await createSquad(agent, owner.token, { visibility: 'public' });

  await agent
    .post(`/api/squads/${squad.slug}/join`)
    .set('Authorization', `Bearer ${member.token}`)
    .send({});
  const second = await agent
    .post(`/api/squads/${squad.slug}/join`)
    .set('Authorization', `Bearer ${member.token}`)
    .send({});

  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyMember, true);

  const stored = await Squad.findOne({ slug: squad.slug });
  assert.equal(stored.members.length, 2); // owner + member, not three
});

test('private squad content is members-only', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const outsider = await registerUser(agent);

  const squad = await createSquad(agent, owner.token);

  const denied = await agent
    .get(`/api/squads/${squad.slug}/feed`)
    .set('Authorization', `Bearer ${outsider.token}`);
  assert.equal(denied.status, 403);

  const allowed = await agent
    .get(`/api/squads/${squad.slug}/feed`)
    .set('Authorization', `Bearer ${owner.token}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.squad.slug, squad.slug);
  assert.equal(allowed.body.members.length, 1);
});

test('the owner cannot leave their own squad', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const squad = await createSquad(agent, owner.token);

  const res = await agent
    .delete(`/api/squads/${squad.slug}/leave`)
    .set('Authorization', `Bearer ${owner.token}`);

  assert.equal(res.status, 400);
});

test('squad endpoints require authentication', async () => {
  const agent = app();
  const res = await agent.get('/api/squads');
  assert.equal(res.status, 401);
});
