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

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Los tests fijan el teléfono directamente en el modelo. El flujo real de alta
// por teléfono exige un código de verificación, y aquí lo que se prueba es la
// búsqueda, no el alta.
async function withPhone(userId, phone) {
  await User.updateOne({ _id: userId }, { phone, phoneVerified: true });
}

test('looking up a phone number requires a session', async () => {
  const agent = app();
  const res = await agent.post('/api/users/lookup-phone').send({ phone: '+34600111222' });
  assert.equal(res.status, 401);
});

test('a registered number resolves to its account', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  await withPhone(b.user.id, '+34600111222');

  const res = await agent
    .post('/api/users/lookup-phone')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '+34600111222' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.id, b.user.id);
  assert.equal(res.body.user.username, b.username);
});

test('the number can be typed without the international prefix', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  await withPhone(b.user.id, '+34600111222');

  // El marcador manda el país del selector cuando el número va sin prefijo.
  const res = await agent
    .post('/api/users/lookup-phone')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '600111222', country: 'ES' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.id, b.user.id);
});

test('an unknown number reports nothing found', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent
    .post('/api/users/lookup-phone')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '+34600999888' });

  assert.equal(res.status, 404);
});

test('looking up your own number is rejected like an unknown one', async () => {
  const agent = app();
  const a = await registerUser(agent);
  await withPhone(a.user.id, '+34600111222');

  const res = await agent
    .post('/api/users/lookup-phone')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '+34600111222' });

  // Mismo mensaje que "no existe" a propósito: si dijera "es tu número", el
  // endpoint serviría para confirmar qué teléfonos están registrados.
  assert.equal(res.status, 404);
  assert.match(res.body.error, /No hay ninguna cuenta/);
});

test('an invalid number is rejected with the country named', async () => {
  const agent = app();
  const a = await registerUser(agent);

  const res = await agent
    .post('/api/users/lookup-phone')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '123', country: 'ES' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /inválido/i);
});

test('the response never leaks the phone or the email', async () => {
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  await withPhone(b.user.id, '+34600111222');

  const res = await agent
    .post('/api/users/lookup-phone')
    .set('Authorization', `Bearer ${a.token}`)
    .send({ phone: '+34600111222' });

  assert.equal(res.status, 200);
  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes('+34600111222'), 'el teléfono no debe salir');
  assert.ok(!serialised.includes(b.email), 'el email no debe salir');
});
