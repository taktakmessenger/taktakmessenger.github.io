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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function uploadPhoto(agent, token) {
  const res = await agent
    .post('/api/listings/photos')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', PNG_1X1, 'foto.png');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.photo;
}

async function createListing(agent, token, body = {}) {
  const res = await agent
    .post('/api/listings')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Bicicleta', price: 500, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test('Marketak es de lectura pública', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  await createListing(agent, ana.token, { title: 'Bicicleta roja' });

  const res = await agent.get('/api/listings');
  assert.equal(res.status, 200);
  assert.equal(res.body.listings.length, 1);
  assert.equal(res.body.listings[0].title, 'Bicicleta roja');
  assert.equal(res.body.listings[0].seller.username, ana.user.username);
});

test('publicar un anuncio requiere sesión', async () => {
  const agent = app();
  const res = await agent.post('/api/listings').send({ title: 'X', price: 1 });
  assert.equal(res.status, 401);
});

test('un anuncio sin título se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/listings')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ title: '   ', price: 100 });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('un precio negativo se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/listings')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ title: 'Algo', price: -5 });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('una categoría desconocida se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/listings')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ title: 'Algo', price: 100, category: 'inventada' });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('publica una foto y aparece como portada del anuncio', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const photo = await uploadPhoto(agent, ana.token);

  const listing = await createListing(agent, ana.token, { photos: [photo] });
  assert.equal(listing.photos.length, 1);
  assert.ok(listing.photos[0].url.startsWith('/uploads/market/'));

  const res = await agent.get('/api/listings');
  assert.equal(res.body.listings[0].photos[0].url, photo.url);
});

test('una foto externa se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/listings')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({
      title: 'Algo',
      price: 100,
      photos: [{ url: 'https://ejemplo.com/foto.png', name: 'foto.png' }],
    });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('filtrar por categoría devuelve solo esa categoría', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  await createListing(agent, ana.token, { title: 'Móvil', category: 'electronica' });
  await createListing(agent, ana.token, { title: 'Camisa', category: 'ropa' });

  const res = await agent.get('/api/listings?category=ropa');
  assert.equal(res.status, 200);
  assert.equal(res.body.listings.length, 1);
  assert.equal(res.body.listings[0].title, 'Camisa');
});

test('buscar por texto encuentra por título y descripción', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  await createListing(agent, ana.token, { title: 'Bicicleta de montaña' });
  await createListing(agent, ana.token, { title: 'Nevera', description: 'bicicleta de regalo' });
  await createListing(agent, ana.token, { title: 'Televisor' });

  const res = await agent.get('/api/listings?q=bici');
  assert.equal(res.status, 200);
  assert.equal(res.body.listings.length, 2);
});

test('el detalle cuenta una visita', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const listing = await createListing(agent, ana.token);

  const first = await agent.get(`/api/listings/${listing._id}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.views, 1);

  const second = await agent.get(`/api/listings/${listing._id}`);
  assert.equal(second.body.views, 2);
});

test('el vendedor marca el anuncio como vendido', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const listing = await createListing(agent, ana.token);

  const res = await agent
    .patch(`/api/listings/${listing._id}/status`)
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ status: 'sold' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'sold');

  const feed = await agent.get('/api/listings');
  assert.equal(feed.body.listings[0].status, 'sold');
});

test('otro usuario no puede marcar como vendido el anuncio ajeno', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const luis = await registerUser(agent);
  const listing = await createListing(agent, ana.token);

  const res = await agent
    .patch(`/api/listings/${listing._id}/status`)
    .set('Authorization', `Bearer ${luis.token}`)
    .send({ status: 'sold' });
  assert.equal(res.status, 403);
});

test('solo el vendedor o un admin pueden borrar el anuncio', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const luis = await registerUser(agent);
  const listing = await createListing(agent, ana.token);

  const denied = await agent
    .delete(`/api/listings/${listing._id}`)
    .set('Authorization', `Bearer ${luis.token}`);
  assert.equal(denied.status, 403);

  const ok = await agent
    .delete(`/api/listings/${listing._id}`)
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(ok.status, 200);

  // El borrado es lógico: deja de servirse.
  const feed = await agent.get('/api/listings');
  assert.equal(feed.body.listings.length, 0);
});
