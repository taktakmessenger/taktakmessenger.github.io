const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser, setWallet } = require('./helpers');
const User = require('../src/models/User');
const Squad = require('../src/models/Squad');
const { signToken } = require('../src/utils/tokens');

// Rutas HTTP de los torneos: la validación y el control de acceso de verdad, no
// solo el servicio. Lo que se comprueba es que un jugador no pueda crear un
// torneo, que el administrador sí, y que la inscripción cobre por el servidor.

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function makeAdmin() {
  return User.create({
    username: 'eljefe',
    email: 'eljefe@example.com',
    password: 'clave12345',
    role: 'admin',
  });
}

async function makeSquad(owner, slug) {
  return Squad.create({
    name: slug,
    slug,
    owner: owner._id,
    visibility: 'public',
    voiceRoom: `voice-${slug}`,
  });
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

const when = () => new Date(Date.now() + 86400_000).toISOString();

test('un jugador no puede crear un torneo', async () => {
  const { token } = await registerUser(app(), { username: 'jugador' });
  const res = await app()
    .post('/api/admin/poker-events')
    .set(auth(token))
    .send({ title: 'Torneo pirata', squadSlug: 'x', scheduledAt: when(), entryCost: 100, maxPlayers: 9 });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('el administrador crea un torneo y lo ve en la lista', async () => {
  const admin = await makeAdmin();
  await makeSquad(admin, 'mesa-admin');
  const token = signToken(admin);

  const created = await app()
    .post('/api/admin/poker-events')
    .set(auth(token))
    .send({
      title: 'Torneo de prueba',
      squadSlug: 'mesa-admin',
      scheduledAt: when(),
      entryCost: 100,
      maxPlayers: 9,
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.event.status, 'scheduled');
  assert.deepEqual(created.body.event.projectedPlaces.map((p) => p.amount), [360, 270, 180]);

  const list = await app().get('/api/admin/poker-events').set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.events.length, 1);
  assert.equal(list.body.events[0].title, 'Torneo de prueba');
});

test('el aforo fuera de rango se rechaza con 400', async () => {
  const admin = await makeAdmin();
  await makeSquad(admin, 'mesa-rango');
  const res = await app()
    .post('/api/admin/poker-events')
    .set(auth(signToken(admin)))
    .send({
      title: 'Torneo enorme',
      squadSlug: 'mesa-rango',
      scheduledAt: when(),
      entryCost: 100,
      maxPlayers: 12,
    });
  assert.equal(res.status, 400);
});

test('el jugador se inscribe por la ruta y el torneo queda con un inscrito', async () => {
  const admin = await makeAdmin();
  await makeSquad(admin, 'mesa-jugador');
  const created = await app()
    .post('/api/admin/poker-events')
    .set(auth(signToken(admin)))
    .send({
      title: 'Torneo abierto',
      squadSlug: 'mesa-jugador',
      scheduledAt: when(),
      entryCost: 100,
      maxPlayers: 9,
    });

  const { token, user } = await registerUser(app(), { username: 'ana' });
  await setWallet(user.id, { ttcC: 500, bonusC: 0 });

  const join = await app()
    .post(`/api/poker/events/${created.body.event.id}/join`)
    .set(auth(token));
  assert.equal(join.status, 201, JSON.stringify(join.body));
  assert.equal(join.body.event.seatsTaken, 1);
  assert.equal(join.body.event.players[0].username, 'ana');

  const after = await User.findById(user.id).select('wallet');
  assert.equal(after.wallet.ttcC, 400, 'la entrada se cobró en el servidor');
});

test('listar los torneos de la sala filtra por slug', async () => {
  const admin = await makeAdmin();
  await makeSquad(admin, 'mesa-uno');
  await makeSquad(admin, 'mesa-dos');
  for (const slug of ['mesa-uno', 'mesa-dos']) {
    await app()
      .post('/api/admin/poker-events')
      .set(auth(signToken(admin)))
      .send({ title: `Torneo ${slug}`, squadSlug: slug, scheduledAt: when(), entryCost: 50, maxPlayers: 4 });
  }
  const { token } = await registerUser(app(), { username: 'miron' });
  const res = await app().get('/api/poker/events?squad=mesa-dos').set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.events.length, 1);
  assert.equal(res.body.events[0].title, 'Torneo mesa-dos');
});
