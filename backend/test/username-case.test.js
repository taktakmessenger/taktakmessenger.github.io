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

// El índice de `username` distingue mayúsculas, pero el @usuario no: quien
// escribe `@Elmalayaso` o `@elmalayaso` se refiere a la misma persona. Antes la
// búsqueda era sensible y una variante de caja respondía 404, lo que desde el
// marcador dejaba la llamada inalcanzable aunque la cuenta existiera.

test('the profile route resolves a username regardless of case', async () => {
  const agent = app();
  const a = await registerUser(agent, { username: 'Elmalayaso' });

  const exact = await agent.get('/api/users/Elmalayaso');
  assert.equal(exact.status, 200, JSON.stringify(exact.body));

  const lower = await agent.get('/api/users/elmalayaso');
  assert.equal(lower.status, 200, JSON.stringify(lower.body));
  assert.equal(lower.body.user.username, 'Elmalayaso');
  assert.equal(lower.body.user._id, a.user.id);
});

test('an @ prefix in the path is tolerated', async () => {
  const agent = app();
  await registerUser(agent, { username: 'Elmalayaso' });

  const res = await agent.get('/api/users/%40elmalayaso');
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('a username that genuinely does not exist is still a 404', async () => {
  const agent = app();
  await registerUser(agent, { username: 'Elmalayaso' });

  const res = await agent.get('/api/users/otra_persona');
  assert.equal(res.status, 404);
});

test('following resolves the target regardless of case', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent, { username: 'Elmalayaso' });

  const res = await agent
    .post('/api/users/elmalayaso/follow')
    .set('Authorization', `Bearer ${a.token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.following, true);
  assert.ok(b.user.id);
});

test('registering a name that only differs in case is rejected', async () => {
  const agent = app();
  await registerUser(agent, { username: 'Elmalayaso' });

  const res = await agent.post('/api/auth/register').send({
    username: 'elmalayaso',
    email: 'otra@example.com',
    password: 'secret123',
  });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /ya existe/i);
});
