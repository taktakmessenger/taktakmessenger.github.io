const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

test('register returns a token and never echoes the password', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'bob', email: 'bob@example.com', password: 'secret123' });

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.password, undefined);
});

test('register rejects a duplicate email', async () => {
  const agent = app();
  await registerUser(agent, { email: 'dup@example.com', username: 'dup1' });
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'dup2', email: 'dup@example.com', password: 'secret123' });

  assert.equal(res.status, 400);
});

test('register enforces a minimum password length', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'short', email: 'short@example.com', password: '123' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Datos inválidos');
});

test('register rejects an invalid email', async () => {
  const agent = app();
  const res = await agent
    .post('/api/auth/register')
    .send({ username: 'badmail', email: 'not-an-email', password: 'secret123' });

  assert.equal(res.status, 400);
});

test('login succeeds with correct credentials', async () => {
  const agent = app();
  const user = await registerUser(agent, { email: 'login@example.com', username: 'loginuser' });

  const res = await agent
    .post('/api/auth/login')
    .send({ email: 'login@example.com', password: 'secret123' });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.id, user.user.id);
});

test('login fails with a wrong password', async () => {
  const agent = app();
  await registerUser(agent, { email: 'wrong@example.com', username: 'wrongpass' });

  const res = await agent
    .post('/api/auth/login')
    .send({ email: 'wrong@example.com', password: 'nope' });

  assert.equal(res.status, 400);
});

test('login does not reveal whether an email exists', async () => {
  const agent = app();
  await registerUser(agent, { email: 'real@example.com', username: 'realuser' });

  const unknown = await agent
    .post('/api/auth/login')
    .send({ email: 'ghost@example.com', password: 'secret123' });
  const wrongPass = await agent
    .post('/api/auth/login')
    .send({ email: 'real@example.com', password: 'wrongpass' });

  assert.equal(unknown.body.error, wrongPass.body.error);
});

test('protected routes reject a missing or malformed token', async () => {
  const agent = app();
  assert.equal((await agent.get('/api/users/me')).status, 401);
  assert.equal(
    (await agent.get('/api/users/me').set('Authorization', 'Bearer not.a.jwt')).status,
    401
  );
  assert.equal(
    (await agent.get('/api/users/me').set('Authorization', 'Basic abc')).status,
    401
  );
});

test('admin routes are forbidden for non-admins', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await agent
    .get('/api/admin/stats')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(res.status, 403);
});
