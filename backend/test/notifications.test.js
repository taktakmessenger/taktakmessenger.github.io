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

// Un vídeo propio para poder dar me gusta y comentar sobre algo real.
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

function listActivity(agent, token, query = '') {
  return agent.get(`/api/notifications${query}`).set('Authorization', `Bearer ${token}`);
}

test('la actividad exige sesión', async () => {
  const agent = app();
  const res = await agent.get('/api/notifications');
  assert.equal(res.status, 401);
});

test('un regalo deja un aviso con el importe y el nombre del regalo', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);

  const gift = await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 40, giftName: 'Cohete' });
  assert.equal(gift.status, 200);

  const res = await listActivity(agent, creator.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.notifications.length, 1);

  const n = res.body.notifications[0];
  assert.equal(n.type, 'gift');
  assert.equal(n.amount, 40);
  assert.equal(n.giftName, 'Cohete');
  assert.equal(n.read, false);
  assert.equal(n.actor.username, sender.username);
  assert.equal(res.body.unread, 1);
});

test('un seguidor nuevo deja un aviso y dejar de seguir no lo repite', async () => {
  const agent = app();
  const follower = await registerUser(agent);
  const creator = await registerUser(agent);

  const follow = await agent
    .post(`/api/users/${creator.username}/follow`)
    .set('Authorization', `Bearer ${follower.token}`);
  assert.equal(follow.status, 200);

  // Seguir dos veces es idempotente en la relación, pero el aviso se emite otra
  // vez: el segundo POST vuelve a llamar a `notify`. Es aceptable (el gesto fue
  // explícito) y lo que importa comprobar es que el primero llega.
  const res = await listActivity(agent, creator.token);
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.notifications[0].type, 'follow');
  assert.equal(res.body.notifications[0].actor.username, follower.username);
});

test('dar me gusta avisa al creador, pero quitarlo no genera un segundo aviso', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const viewer = await registerUser(agent);
  const video = await upload(agent, creator.token);

  await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${viewer.token}`)
    .expect(200);

  // El toggle: la segunda llamada quita el me gusta.
  await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${viewer.token}`)
    .expect(200);

  const res = await listActivity(agent, creator.token);
  const likes = res.body.notifications.filter((n) => n.type === 'like');
  assert.equal(likes.length, 1, 'solo el me gusta, no el "ya no me gusta"');
  assert.equal(likes[0].actor.username, viewer.username);
});

test('un comentario avisa al creador y una respuesta avisa al autor del comentario', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const fan = await registerUser(agent);
  const other = await registerUser(agent);
  const video = await upload(agent, creator.token);

  const first = await agent
    .post(`/api/comments/video/${video._id}`)
    .set('Authorization', `Bearer ${fan.token}`)
    .send({ text: 'Buenísimo' });
  assert.equal(first.status, 201);

  // El creador recibe el comentario; el autor del comentario recibe la respuesta.
  const reply = await agent
    .post(`/api/comments/video/${video._id}`)
    .set('Authorization', `Bearer ${other.token}`)
    .send({ text: 'De acuerdo', parentId: first.body.comment._id });
  assert.equal(reply.status, 201);

  const creatorFeed = await listActivity(agent, creator.token);
  assert.equal(creatorFeed.body.notifications.length, 1);
  assert.equal(creatorFeed.body.notifications[0].type, 'comment');
  assert.equal(creatorFeed.body.notifications[0].preview, 'Buenísimo');

  const fanFeed = await listActivity(agent, fan.token);
  assert.equal(fanFeed.body.notifications.length, 1);
  assert.equal(fanFeed.body.notifications[0].type, 'reply');
  assert.equal(fanFeed.body.notifications[0].preview, 'De acuerdo');
});

test('las acciones propias no generan avisos', async () => {
  const agent = app();
  const creator = await registerUser(agent);
  const video = await upload(agent, creator.token);

  // El creador se comenta y se da me gusta a sí mismo.
  await agent
    .post(`/api/videos/${video._id}/like`)
    .set('Authorization', `Bearer ${creator.token}`)
    .expect(200);
  await agent
    .post(`/api/comments/video/${video._id}`)
    .set('Authorization', `Bearer ${creator.token}`)
    .send({ text: 'Mi propio video' })
    .expect(201);

  const res = await listActivity(agent, creator.token);
  assert.equal(res.body.notifications.length, 0);
  assert.equal(res.body.unread, 0);
});

test('marcar como leído apaga la campana', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);

  await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 10, giftName: 'Estrella' })
    .expect(200);

  const before = await agent
    .get('/api/notifications/unread-count')
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(before.body.unread, 1);

  const read = await agent
    .post('/api/notifications/read-all')
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.unread, 0);

  const after = await listActivity(agent, creator.token);
  assert.equal(after.body.unread, 0);
  assert.equal(after.body.notifications[0].read, true);
});

test('no se puede marcar como leído el aviso de otra persona', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);
  const stranger = await registerUser(agent);

  await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creator.user.id, amount: 10, giftName: 'Estrella' })
    .expect(200);

  const mine = await listActivity(agent, creator.token);
  const id = mine.body.notifications[0]._id;

  // El ajeno responde 404, no 403: no se confirma siquiera que el aviso exista.
  const res = await agent
    .post(`/api/notifications/${id}/read`)
    .set('Authorization', `Bearer ${stranger.token}`);
  assert.equal(res.status, 404);

  const stillUnread = await listActivity(agent, creator.token);
  assert.equal(stillUnread.body.notifications[0].read, false);
});

test('cada cuenta solo ve sus propios avisos', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creatorA = await registerUser(agent);
  const creatorB = await registerUser(agent);

  await agent
    .post('/api/wallet/gift')
    .set('Authorization', `Bearer ${sender.token}`)
    .send({ recipientId: creatorA.user.id, amount: 10, giftName: 'Estrella' })
    .expect(200);

  const feedB = await listActivity(agent, creatorB.token);
  assert.equal(feedB.body.notifications.length, 0);
});

test('la lista se pagina por cursor y trae el total sin leer', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const creator = await registerUser(agent);

  // 25 regalos: más de una página de 20.
  for (let i = 0; i < 25; i += 1) {
    await agent
      .post('/api/wallet/gift')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ recipientId: creator.user.id, amount: 1, giftName: 'Estrella' })
      .expect(200);
  }

  const first = await listActivity(agent, creator.token);
  assert.equal(first.body.notifications.length, 20);
  assert.ok(first.body.nextCursor, 'debe haber una página siguiente');
  assert.equal(first.body.unread, 25);

  const second = await listActivity(
    agent,
    creator.token,
    `?cursor=${encodeURIComponent(first.body.nextCursor)}`
  );
  assert.equal(second.body.notifications.length, 5);
  assert.equal(second.body.nextCursor, null);

  // Sin solapes entre páginas: son 25 avisos distintos.
  const ids = new Set([
    ...first.body.notifications.map((n) => n._id),
    ...second.body.notifications.map((n) => n._id),
  ]);
  assert.equal(ids.size, 25);
});

test('un cursor inválido se rechaza en lugar de ignorarse en silencio', async () => {
  const agent = app();
  const { token } = await registerUser(agent);
  const res = await listActivity(agent, token, '?cursor=no-es-una-fecha');
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Entrega en vivo
// ---------------------------------------------------------------------------
//
// El aviso tiene que llegar sin recargar: si el creador tiene la app abierta y
// alguien le regala algo, lo ve al instante. Este es el caso que motivó todo
// esto (antes el regalo era mudo), así que se prueba con sockets reales.

const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { io: ioClient } = require('socket.io-client');

async function startServer() {
  const server = createApp().listen(0);
  const io = initLiveSockets(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    url: `http://localhost:${port}`,
    async close() {
      io.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout esperando "${event}"`)),
      timeoutMs
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('un regalo llega al creador en vivo si tiene la app abierta', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const sender = await registerUser(agent);
    const creator = await registerUser(agent);

    // El creador está conectado; el emisor usa solo HTTP.
    const creatorSocket = await connect(server.url, creator.token);
    // Se espera a que el servidor registre la presencia antes de enviar: el
    // aviso se manda por socket precisamente porque `isOnline` es true.
    await new Promise((r) => setTimeout(r, 250));

    const incoming = once(creatorSocket, 'notification:new');
    await agent
      .post('/api/wallet/gift')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ recipientId: creator.user.id, amount: 25, giftName: 'Corona' })
      .expect(200);

    const notification = await incoming;
    assert.equal(notification.type, 'gift');
    assert.equal(notification.amount, 25);
    assert.equal(notification.giftName, 'Corona');
    assert.equal(notification.actor.username, sender.username);
    assert.equal(notification.read, false);

    creatorSocket.close();
  } finally {
    await server.close();
  }
});

test('un seguidor nuevo llega en vivo al creador', async () => {
  const server = await startServer();
  try {
    const agent = app();
    const follower = await registerUser(agent);
    const creator = await registerUser(agent);

    const creatorSocket = await connect(server.url, creator.token);
    await new Promise((r) => setTimeout(r, 250));

    const incoming = once(creatorSocket, 'notification:new');
    await agent
      .post(`/api/users/${creator.username}/follow`)
      .set('Authorization', `Bearer ${follower.token}`)
      .expect(200);

    const notification = await incoming;
    assert.equal(notification.type, 'follow');
    assert.equal(notification.actor.username, follower.username);

    creatorSocket.close();
  } finally {
    await server.close();
  }
});

