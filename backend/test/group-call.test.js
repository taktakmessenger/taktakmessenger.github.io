process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

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

function connectSocket(url, token) {
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

function onceEvent(socket, event, timeoutMs = 2000) {
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

function neverEvent(socket, event, timeoutMs = 400) {
  return new Promise((resolve, reject) => {
    function onEvent(payload) {
      clearTimeout(timer);
      reject(new Error(`no debía llegar "${event}": ${JSON.stringify(payload)}`));
    }
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, timeoutMs);
    socket.once(event, onEvent);
  });
}

// Invita y espera el acuse del servidor, que es donde viaja el `callId`.
async function invite(socket, to, kind = 'video', origin = 'whataka') {
  const ringing = onceEvent(socket, 'call:group-ringing');
  socket.emit('call:group-invite', { to, kind, origin });
  return ringing;
}

test('el invitado recibe la invitación y el llamante recibe el acuse', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const incoming = onceEvent(socketB, 'call:group-incoming');
    const ringing = await invite(socketA, [b.user.id]);

    const payload = await incoming;
    assert.equal(payload.callId, ringing.callId);
    assert.equal(payload.kind, 'video');
    assert.equal(payload.origin, 'whataka');
    assert.equal(payload.from.id, a.user.id);
    assert.equal(ringing.reachable, 1);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('el invitado que acepta entra y recibe la lista de los que ya estaban', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);
    const joined = onceEvent(socketB, 'call:group-joined');
    socketB.emit('call:group-accept', { callId });

    const payload = await joined;
    assert.equal(payload.callId, callId);
    assert.equal(payload.hostId, a.user.id);
    // El que entra recibe a quien ya estaba para ofrecerle él la conexión.
    assert.deepEqual(
      payload.peers.map((p) => p.id),
      [a.user.id]
    );
    assert.equal(payload.members.length, 2);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('el anfitrión sabe cuándo alguien acepta', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);
    const peerJoined = onceEvent(socketA, 'call:group-peer-joined');
    socketB.emit('call:group-accept', { callId });

    const payload = await peerJoined;
    assert.equal(payload.id, b.user.id);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('la señalización de la malla llega al par indicado', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);
    const joined = onceEvent(socketB, 'call:group-joined');
    socketB.emit('call:group-accept', { callId });
    await joined;

    const offer = onceEvent(socketA, 'call:group-offer');
    socketB.emit('call:group-offer', { callId, to: a.user.id, sdp: { type: 'offer' } });

    const payload = await offer;
    assert.equal(payload.from, b.user.id);
    assert.deepEqual(payload.sdp, { type: 'offer' });
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('sin invitación no se puede entrar aunque se sepa el callId', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const intruder = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);
  const socketC = await connectSocket(server.url, intruder.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);

    const error = onceEvent(socketC, 'call:group-error');
    const joined = neverEvent(socketC, 'call:group-joined');
    socketC.emit('call:group-accept', { callId });

    assert.match((await error).error, /invitado/i);
    await joined;
  } finally {
    socketA.close();
    socketB.close();
    socketC.close();
    await server.close();
  }
});

test('una llamada no admite más de cuatro personas', async () => {
  const server = await startServer();
  const agent = app();
  const users = [];
  for (let i = 0; i < 5; i += 1) users.push(await registerUser(agent));

  const sockets = [];
  for (const u of users) sockets.push(await connectSocket(server.url, u.token));

  try {
    // El anfitrión ocupa una plaza, así que solo se invita a tres de los cuatro
    // candidatos: el tope se aplica al invitar, no al entrar.
    const { callId, invitees } = await invite(
      sockets[0],
      users.slice(1).map((u) => u.user.id)
    );
    assert.equal(invitees.length, 3);

    // El cuarto candidato no recibe invitación: ni siquiera se le ofrece.
    const notInvited = neverEvent(sockets[4], 'call:group-incoming', 600);
    await notInvited;

    for (let i = 1; i <= 3; i += 1) {
      const joined = onceEvent(sockets[i], 'call:group-joined');
      sockets[i].emit('call:group-accept', { callId });
      await joined;
    }
  } finally {
    for (const s of sockets) s.close();
    await server.close();
  }
});

test('la llamada se cierra sola cuando se va el último', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);
    const joined = onceEvent(socketB, 'call:group-joined');
    socketB.emit('call:group-accept', { callId });
    await joined;

    // Se va el anfitrión: al invitado le llega el aviso y la llamada queda con
    // una sola persona, así que sigue viva.
    const left = onceEvent(socketB, 'call:group-left');
    socketA.emit('call:group-leave', { callId });
    assert.equal((await left).userId, a.user.id);

    // Se va el último: la llamada ya no existe, así que aceptarla da error.
    const ended = onceEvent(socketB, 'call:group-ended');
    socketB.emit('call:group-leave', { callId });
    await ended;

    const error = onceEvent(socketB, 'call:group-error');
    socketB.emit('call:group-accept', { callId });
    assert.match((await error).error, /ya no existe/i);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('rechazar avisa al anfitrión sin meterse en la llamada', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);
    const rejected = onceEvent(socketA, 'call:group-rejected');
    socketB.emit('call:group-reject', { callId });
    assert.equal((await rejected).from, b.user.id);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('la señalización no cruza a otra llamada ni a un desconocido', async () => {
  const server = await startServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const { callId } = await invite(socketA, [b.user.id]);
    const joined = onceEvent(socketB, 'call:group-joined');
    socketB.emit('call:group-accept', { callId });
    await joined;

    // Un `callId` que no es el suyo no debe reenviar nada.
    const nothing = neverEvent(socketA, 'call:group-offer');
    socketB.emit('call:group-offer', { callId: 'otra', to: a.user.id, sdp: {} });
    await nothing;
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});
