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
const { fold, buildAccentInsensitiveRegex } = require('../src/lib/textSearch');
const searchService = require('../src/services/searchService');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// --- Plegado de texto -------------------------------------------------------

test('fold quita acentos y baja a minúsculas', () => {
  assert.equal(fold('Caimán'), 'caiman');
  assert.equal(fold('  CAFÉ  '), 'cafe');
  assert.equal(fold('Niño'), 'nino');
  assert.equal(fold(null), '');
});

test('el patrón casa con y sin tilde, en cualquier caso', () => {
  const pattern = buildAccentInsensitiveRegex('cafe');
  assert.ok(pattern.test('Café'));
  assert.ok(pattern.test('cafe'));
  assert.ok(pattern.test('El CAFÉ de la esquina'));
  assert.ok(!pattern.test('té'));

  // Al revés: buscar con tilde también encuentra sin ella.
  const withAccent = buildAccentInsensitiveRegex('café');
  assert.ok(withAccent.test('cafe'));
});

test('el patrón escapa los caracteres de expresión regular', () => {
  // Sin escapar, "c++" lanzaría un error de sintaxis al construir la regex.
  assert.doesNotThrow(() => buildAccentInsensitiveRegex('c++'));
  assert.ok(buildAccentInsensitiveRegex('a.b').test('a.b'));
  assert.ok(!buildAccentInsensitiveRegex('a.b').test('axb'));
});

test('una consulta vacía no produce patrón', () => {
  assert.equal(buildAccentInsensitiveRegex('   '), null);
  assert.equal(buildAccentInsensitiveRegex(''), null);
});

test('la ñ se pliega y vuelve a admitirse', () => {
  const pattern = buildAccentInsensitiveRegex('nino');
  assert.ok(pattern.test('Niño'));
});

// --- Búsqueda por la API ----------------------------------------------------

test('la búsqueda es pública y devuelve las tres listas', async () => {
  const agent = app();
  const res = await agent.get('/api/search').query({ q: 'nada' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.users, []);
  assert.deepEqual(res.body.videos, []);
  assert.deepEqual(res.body.tags, []);
});

test('encuentra personas por usuario y por nombre visible, sin acentos', async () => {
  const agent = app();
  await registerUser(agent, { username: 'caiman_ana' });
  const bob = await registerUser(agent, { username: 'bobito' });
  await User.updateOne(
    { _id: bob.user.id },
    { $set: { 'profile.displayName': 'Caimán Bob' } }
  );

  const byUsername = await agent.get('/api/search').query({ q: 'caiman' });
  assert.equal(byUsername.status, 200);
  const usernames = byUsername.body.users.map((u) => u.username);
  assert.ok(usernames.includes('caiman_ana'));
  assert.ok(usernames.includes('bobito'));

  // "caiman" sin tilde tiene que encontrar a "Caimán Bob".
  const byDisplay = await agent.get('/api/search').query({ q: 'caiman bob' });
  assert.ok(byDisplay.body.users.some((u) => u.username === 'bobito'));
});

test('un @ delante no rompe la búsqueda de personas', async () => {
  const agent = app();
  await registerUser(agent, { username: 'conarroba' });
  const res = await agent.get('/api/search').query({ q: '@conarroba' });
  // El @ no forma parte del nombre de usuario guardado, así que se busca tal
  // cual: el servicio no lo recorta, y el resultado correcto es no encontrarlo
  // por el símbolo. Lo que se comprueba es que no falla.
  assert.equal(res.status, 200);
});

test('encuentra vídeos por título, descripción y etiqueta', async () => {
  const agent = app();
  const user = await registerUser(agent);

  await Video.create({
    title: 'Receta de café frío',
    videoUrl: '/uploads/a.mp4',
    creator: user.user.id,
    moderationStatus: 'approved',
  });
  await Video.create({
    title: 'Un paseo',
    description: 'por el café del centro',
    videoUrl: '/uploads/b.mp4',
    creator: user.user.id,
    moderationStatus: 'approved',
  });
  await Video.create({
    title: 'Otra cosa',
    tags: ['cafeterias'],
    videoUrl: '/uploads/c.mp4',
    creator: user.user.id,
    moderationStatus: 'approved',
  });

  const res = await agent.get('/api/search').query({ q: 'cafe' });
  assert.equal(res.status, 200);
  const titles = res.body.videos.map((v) => v.title);
  assert.equal(titles.length, 3);
  assert.ok(titles.includes('Receta de café frío'));
  assert.ok(titles.includes('Un paseo'));
});

test('los vídeos rechazados no salen en la búsqueda', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await Video.create({
    title: 'Rechazado café',
    videoUrl: '/uploads/x.mp4',
    creator: user.user.id,
    moderationStatus: 'rejected',
  });

  const res = await agent.get('/api/search').query({ q: 'cafe' });
  assert.equal(res.body.videos.length, 0);
});

test('el contenido para adultos se oculta a quien no verificó su edad', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await Video.create({
    title: 'Café para adultos',
    videoUrl: '/uploads/nsfw.mp4',
    creator: user.user.id,
    moderationStatus: 'approved',
    isNSFW: true,
  });

  // Anónimo: no lo ve.
  const anon = await agent.get('/api/search').query({ q: 'cafe' });
  assert.equal(anon.body.videos.length, 0);

  // Con sesión pero sin verificación: tampoco.
  const logged = await agent
    .get('/api/search')
    .query({ q: 'cafe' })
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(logged.body.videos.length, 0);
});

test('las etiquetas se agrupan con su número de vídeos', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await Video.create([
    {
      title: 'A',
      tags: ['viajes'],
      videoUrl: '/uploads/1.mp4',
      creator: user.user.id,
      moderationStatus: 'approved',
    },
    {
      title: 'B',
      tags: ['viajes'],
      videoUrl: '/uploads/2.mp4',
      creator: user.user.id,
      moderationStatus: 'approved',
    },
  ]);

  const res = await agent.get('/api/search').query({ q: 'viaj' });
  assert.equal(res.status, 200);
  assert.equal(res.body.tags.length, 1);
  assert.equal(res.body.tags[0].tag, 'viajes');
  assert.equal(res.body.tags[0].count, 2);
});

test('type=users devuelve solo personas', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await Video.create({
    title: 'cafe video',
    videoUrl: '/uploads/a.mp4',
    creator: user.user.id,
    moderationStatus: 'approved',
  });

  const res = await agent.get('/api/search').query({ q: 'cafe', type: 'users' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.videos, []);
  assert.deepEqual(res.body.tags, []);
});

test('la relevancia pone primero la coincidencia exacta de usuario', async () => {
  const agent = app();
  await registerUser(agent, { username: 'sol' });
  await registerUser(agent, { username: 'sol_y_sombra' });

  const res = await agent.get('/api/search').query({ q: 'sol' });
  assert.equal(res.body.users[0].username, 'sol');
});

test('la búsqueda no revienta con caracteres especiales', async () => {
  const agent = app();
  for (const q of ['(', '[', 'a|b', '*', '\\', '?']) {
    const res = await agent.get('/api/search').query({ q });
    assert.equal(res.status, 200, `falló con "${q}"`);
  }
});

test('searchService.search devuelve vacío sin término', async () => {
  const result = await searchService.search('   ');
  assert.deepEqual(result, { query: '', users: [], videos: [], tags: [] });
});
