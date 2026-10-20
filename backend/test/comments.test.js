const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
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

async function upload(agent, token, overrides = {}) {
  const res = await agent
    .post('/api/videos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Video',
      videoUrl: 'https://cdn.example.com/v.mp4',
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.video;
}

function post(agent, token, videoId, body) {
  return agent
    .post(`/api/comments/video/${videoId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

test('un comentario se publica y aparece en el hilo', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const res = await post(agent, author.token, video._id, { text: 'Buen video' });
  assert.equal(res.status, 201);
  assert.equal(res.body.comment.text, 'Buen video');

  const list = await agent.get(`/api/comments/video/${video._id}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.comments.length, 1);
  assert.equal(list.body.comments[0].author.username, author.username);
});

test('el contador del video refleja los comentarios reales', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  await post(agent, author.token, video._id, { text: 'uno' });
  await post(agent, author.token, video._id, { text: 'dos' });

  const found = await agent.get(`/api/videos/${video._id}`);
  assert.equal(found.body.video.comments, 2);
});

test('una respuesta no infla el contador de comentarios del video', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const parent = await post(agent, author.token, video._id, { text: 'padre' });
  await post(agent, author.token, video._id, {
    text: 'respuesta',
    parentId: parent.body.comment._id,
  });

  const found = await agent.get(`/api/videos/${video._id}`);
  assert.equal(found.body.video.comments, 1, 'la respuesta no es una linea aparte');

  const replies = await agent.get(
    `/api/comments/${parent.body.comment._id}/replies`
  );
  assert.equal(replies.body.replies.length, 1);
  assert.equal(replies.body.replies[0].text, 'respuesta');
});

test('responder a una respuesta la cuelga del comentario raiz', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const root = await post(agent, author.token, video._id, { text: 'raiz' });
  const reply = await post(agent, author.token, video._id, {
    text: 'nivel 2',
    parentId: root.body.comment._id,
  });
  const nested = await post(agent, author.token, video._id, {
    text: 'nivel 3',
    parentId: reply.body.comment._id,
  });

  assert.equal(
    String(nested.body.comment.parent),
    String(root.body.comment._id),
    'no debe crear mas de un nivel de anidamiento'
  );
});

test('no se puede responder a un comentario de otro video', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const first = await upload(agent, author.token);
  const second = await upload(agent, author.token);

  const parent = await post(agent, author.token, first._id, { text: 'padre' });
  const res = await post(agent, author.token, second._id, {
    text: 'cruzado',
    parentId: parent.body.comment._id,
  });

  assert.equal(res.status, 400);
});

test('solo el autor puede borrar su comentario', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const other = await registerUser(agent);
  const video = await upload(agent, author.token);

  const comment = await post(agent, author.token, video._id, { text: 'mio' });

  const denied = await agent
    .delete(`/api/comments/${comment.body.comment._id}`)
    .set('Authorization', `Bearer ${other.token}`);
  assert.equal(denied.status, 403);

  const allowed = await agent
    .delete(`/api/comments/${comment.body.comment._id}`)
    .set('Authorization', `Bearer ${author.token}`);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.deleted, true);
});

test('un comentario borrado no expone su texto pero conserva el hueco', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const comment = await post(agent, author.token, video._id, { text: 'secreto' });
  await agent
    .delete(`/api/comments/${comment.body.comment._id}`)
    .set('Authorization', `Bearer ${author.token}`);

  const list = await agent.get(`/api/comments/video/${video._id}`);
  assert.equal(list.body.comments.length, 1);
  assert.equal(list.body.comments[0].text, '');
  assert.equal(list.body.comments[0].author, null);
  assert.equal(list.body.comments[0].deleted, true);

  const found = await agent.get(`/api/videos/${video._id}`);
  assert.equal(found.body.video.comments, 0, 'el contador baja al borrar');
});

test('los me gusta de un comentario no se duplican al tocar varias veces', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const liker = await registerUser(agent);
  const video = await upload(agent, author.token);
  const comment = await post(agent, author.token, video._id, { text: 'dale' });

  const first = await agent
    .post(`/api/comments/${comment.body.comment._id}/like`)
    .set('Authorization', `Bearer ${liker.token}`);
  assert.deepEqual(first.body, { likes: 1, liked: true });

  const second = await agent
    .post(`/api/comments/${comment.body.comment._id}/like`)
    .set('Authorization', `Bearer ${liker.token}`);
  assert.deepEqual(second.body, { likes: 0, liked: false });
});

test('escribir un comentario requiere sesion', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const res = await agent.post(`/api/comments/video/${video._id}`).send({ text: 'anon' });
  assert.equal(res.status, 401);
});

test('leer un hilo es publico para contenido publico', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);
  await post(agent, author.token, video._id, { text: 'hola' });

  const res = await agent.get(`/api/comments/video/${video._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.comments.length, 1);
});

test('un comentario vacio se rechaza', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const res = await post(agent, author.token, video._id, { text: '   ' });
  assert.equal(res.status, 400);
});

test('un comentario demasiado largo se rechaza', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  const res = await post(agent, author.token, video._id, { text: 'x'.repeat(501) });
  assert.equal(res.status, 400);
});

test('el hilo se pagina por cursor', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);

  for (let i = 0; i < 5; i += 1) {
    await post(agent, author.token, video._id, { text: `comentario ${i}` });
  }

  const page1 = await agent.get(`/api/comments/video/${video._id}?limit=2`);
  assert.equal(page1.body.comments.length, 2);
  assert.ok(page1.body.nextCursor);

  const page2 = await agent.get(
    `/api/comments/video/${video._id}?limit=2&cursor=${page1.body.nextCursor}`
  );
  assert.equal(page2.body.comments.length, 2);

  const ids = new Set([
    ...page1.body.comments.map((c) => c._id),
    ...page2.body.comments.map((c) => c._id),
  ]);
  assert.equal(ids.size, 4, 'las paginas no deben repetir comentarios');
});

test('borrar el video retira su hilo', async () => {
  const agent = app();
  const author = await registerUser(agent);
  const video = await upload(agent, author.token);
  await post(agent, author.token, video._id, { text: 'adios' });

  const del = await agent
    .delete(`/api/videos/${video._id}`)
    .set('Authorization', `Bearer ${author.token}`);
  assert.equal(del.status, 200);

  const list = await agent.get(`/api/comments/video/${video._id}`);
  assert.equal(list.status, 404);

  const stored = await mongoose.connection.collection('comments').findOne({});
  assert.equal(stored.text, '', 'el texto no debe sobrevivir al video');
});

test('no se puede comentar un video inexistente', async () => {
  const agent = app();
  const author = await registerUser(agent);

  const res = await post(agent, author.token, new mongoose.Types.ObjectId(), {
    text: 'fantasma',
  });
  assert.equal(res.status, 404);
});

test('un video para adultos oculta su hilo a quien no verifico su edad', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const viewer = await registerUser(agent);

  // The creator must be age-verified to publish adult content.
  await mongoose.connection
    .collection('users')
    .updateOne(
      { username: creator.username },
      { $set: { 'ageVerification.status': 'verified', 'ageVerification.method': 'admin' } }
    );

  const video = await upload(agent, creator.token, { isNSFW: true });
  await post(agent, creator.token, video._id, { text: 'solo adultos' });

  const denied = await agent
    .get(`/api/comments/video/${video._id}`)
    .set('Authorization', `Bearer ${viewer.token}`);
  assert.equal(denied.status, 404, 'el hilo no debe revelar contenido restringido');

  const allowed = await agent
    .get(`/api/comments/video/${video._id}`)
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(allowed.status, 200);
});
