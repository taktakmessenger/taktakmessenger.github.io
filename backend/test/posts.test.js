const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
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

async function createPost(agent, token, body) {
  const res = await agent.post('/api/posts').set('Authorization', `Bearer ${token}`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test('el muro es de lectura pública', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  await createPost(agent, ana.token, { text: 'Mi primera publicación' });

  // Sin token: se ve el muro, pero `liked` es falso para todos.
  const res = await agent.get('/api/posts');
  assert.equal(res.status, 200);
  assert.equal(res.body.posts.length, 1);
  assert.equal(res.body.posts[0].text, 'Mi primera publicación');
  assert.equal(res.body.posts[0].liked, false);
  assert.equal(res.body.posts[0].author.username, ana.user.username);
});

test('publicar requiere sesión', async () => {
  const agent = app();
  const res = await agent.post('/api/posts').send({ text: 'sin sesión' });
  assert.equal(res.status, 401);
});

test('una publicación vacía se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/posts')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({ text: '   ' });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('publica una imagen y aparece en el muro', async () => {
  const agent = app();
  const ana = await registerUser(agent);

  const up = await agent
    .post('/api/posts/attachments')
    .set('Authorization', `Bearer ${ana.token}`)
    .attach('file', PNG_1X1, 'mi foto.png');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.attachment.kind, 'image');
  assert.match(up.body.attachment.url, /^\/uploads\/wall\//);
  assert.equal(up.body.attachment.name, 'mi_foto.png');

  const post = await createPost(agent, ana.token, {
    text: 'Con foto',
    attachment: up.body.attachment,
  });
  assert.equal(post.attachment.kind, 'image');
  assert.equal(post.text, 'Con foto');

  // El archivo existe de verdad en disco.
  const file = path.join(
    process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'),
    'wall',
    path.basename(up.body.attachment.url)
  );
  const stat = await fs.stat(file);
  assert.ok(stat.size > 0);
});

test('solo se admiten imágenes o vídeos como adjunto', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/posts/attachments')
    .set('Authorization', `Bearer ${ana.token}`)
    .attach('file', Buffer.from('%PDF-1.4'), 'documento.pdf');
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('un adjunto fuera de nuestra subida se rechaza', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const res = await agent
    .post('/api/posts')
    .set('Authorization', `Bearer ${ana.token}`)
    .send({
      text: 'trampa',
      attachment: { kind: 'image', url: 'https://ejemplo.com/x.png', name: 'x.png' },
    });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('el me gusta es idempotente y se refleja por usuario', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const post = await createPost(agent, ana.token, { text: 'Dame me gusta' });

  const first = await agent
    .post(`/api/posts/${post._id}/like`)
    .set('Authorization', `Bearer ${beto.token}`);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { likes: 1, liked: true });

  // El segundo toque quita el me gusta: no infla el contador.
  const second = await agent
    .post(`/api/posts/${post._id}/like`)
    .set('Authorization', `Bearer ${beto.token}`);
  assert.deepEqual(second.body, { likes: 0, liked: false });

  // Con sesión, `liked` refleja el estado propio.
  await agent.post(`/api/posts/${post._id}/like`).set('Authorization', `Bearer ${beto.token}`);
  const asBeto = await agent.get('/api/posts').set('Authorization', `Bearer ${beto.token}`);
  assert.equal(asBeto.body.posts[0].liked, true);
  const asAna = await agent.get('/api/posts').set('Authorization', `Bearer ${ana.token}`);
  assert.equal(asAna.body.posts[0].liked, false);
});

test('comentar sube el contador y avisa al autor', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const post = await createPost(agent, ana.token, { text: 'Comenta aquí' });

  const res = await agent
    .post(`/api/posts/${post._id}/comments`)
    .set('Authorization', `Bearer ${beto.token}`)
    .send({ text: 'Buenísima' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.text, 'Buenísima');
  assert.equal(res.body.author.username, beto.user.username);

  const list = await agent.get(`/api/posts/${post._id}/comments`);
  assert.equal(list.body.comments.length, 1);

  // El contador de la publicación subió.
  const feed = await agent.get('/api/posts');
  assert.equal(feed.body.posts[0].comments, 1);

  // El autor recibió el aviso, con el tipo del muro.
  const notifs = await agent
    .get('/api/notifications')
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(notifs.body.notifications[0].type, 'post_comment');
  assert.equal(notifs.body.notifications[0].preview, 'Buenísima');
});

test('solo el autor o un admin pueden borrar la publicación', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const post = await createPost(agent, ana.token, { text: 'Mía' });

  const forbidden = await agent
    .delete(`/api/posts/${post._id}`)
    .set('Authorization', `Bearer ${beto.token}`);
  assert.equal(forbidden.status, 403);

  const ok = await agent
    .delete(`/api/posts/${post._id}`)
    .set('Authorization', `Bearer ${ana.token}`);
  assert.equal(ok.status, 200);

  // Ya no se sirve.
  const feed = await agent.get('/api/posts');
  assert.equal(feed.body.posts.length, 0);
});

test('un comentario borrado conserva su hueco pero no su texto', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  const post = await createPost(agent, ana.token, { text: 'Con hilo' });

  const comment = await agent
    .post(`/api/posts/${post._id}/comments`)
    .set('Authorization', `Bearer ${beto.token}`)
    .send({ text: 'Lo borro' });

  const del = await agent
    .delete(`/api/posts/comments/${comment.body._id}`)
    .set('Authorization', `Bearer ${beto.token}`);
  assert.equal(del.status, 200);

  const list = await agent.get(`/api/posts/${post._id}/comments`);
  assert.equal(list.body.comments.length, 0);

  // El contador vuelve a cero.
  const feed = await agent.get('/api/posts');
  assert.equal(feed.body.posts[0].comments, 0);
});

test('el muro se pagina por cursor', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  for (let i = 0; i < 5; i += 1) {
    await createPost(agent, ana.token, { text: `Entrada ${i}` });
  }

  const first = await agent.get('/api/posts?limit=2');
  assert.equal(first.body.posts.length, 2);
  assert.ok(first.body.nextCursor);

  const second = await agent.get(
    `/api/posts?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`
  );
  assert.equal(second.body.posts.length, 2);
  // Ninguna entrada repetida entre páginas.
  const ids = new Set([...first.body.posts, ...second.body.posts].map((p) => p._id));
  assert.equal(ids.size, 4);
});

test('se puede filtrar el muro por autor', async () => {
  const agent = app();
  const ana = await registerUser(agent);
  const beto = await registerUser(agent);
  await createPost(agent, ana.token, { text: 'De Ana' });
  await createPost(agent, beto.token, { text: 'De Beto' });

  const res = await agent.get(`/api/posts?authorId=${ana.user.id}`);
  assert.equal(res.body.posts.length, 1);
  assert.equal(res.body.posts[0].text, 'De Ana');
});
