const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  registerUser,
} = require('./helpers');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const pushService = require('../src/services/pushService');
const { io: ioClient } = require('socket.io-client');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// Estos tests cubren la parte difícil de "que suene como WhatsApp": cuando el
// otro no está conectado, el servidor manda un push y guarda la invitación,
// porque el aviso se emitió antes de que el destinatario tuviera socket.
//
// El envío real sale a FCM/APNs por internet, que en tests no existe, así que
// se sustituye `sendToUser` — y solo eso. Todo lo demás es real: servidor HTTP,
// sockets, autenticación y la lógica de liveSockets. Es la frontera de red la
// que no se puede ejercitar aquí, no la lógica que se quiere probar.

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
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Sustituye el envío al servicio de push por uno que solo cuenta y dice que sí.
// `sent` alto hace que el servidor crea que el dispositivo sonó de verdad, que
// es lo que dispara el guardado de la invitación pendiente.
function stubPush({ configured = true, sent = 1 } = {}) {
  const original = {
    isConfigured: pushService.isConfigured,
    sendToUser: pushService.sendToUser,
  };
  pushService.isConfigured = () => configured;
  pushService.sendToUser = async () => ({ sent, total: sent });
  return () => {
    pushService.isConfigured = original.isConfigured;
    pushService.sendToUser = original.sendToUser;
  };
}

test('an invite to an online user arrives live and sends no push', async () => {
  const server = await startServer();
  const restore = stubPush();
  let pushCalls = 0;
  const realSend = pushService.sendToUser;
  pushService.sendToUser = (...args) => {
    pushCalls += 1;
    return realSend(...args);
  };

  try {
    const agent = require('./helpers').app();
    const { token: tokenA, user: userA } = await registerUser(agent, { username: 'livea' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'liveb' });

    const socketA = await connect(server.url, tokenA);
    const socketB = await connect(server.url, tokenB);

    const incoming = once(socketB, 'call:incoming');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'audio' });

    const payload = await incoming;
    assert.equal(String(payload.from.id), String(userA.id || userA._id));
    // Con el otro conectado no se manda push: la llamada ya entra en vivo y una
    // notificación sería un aviso duplicado.
    assert.equal(pushCalls, 0);

    socketA.close();
    socketB.close();
  } finally {
    restore();
    await server.close();
  }
});

test('an invite to an offline user sends a push and rings rather than giving up', async () => {
  const server = await startServer();
  const restore = stubPush({ sent: 1 });

  try {
    const agent = require('./helpers').app();
    const { token: tokenA } = await registerUser(agent, { username: 'offa' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'offb' });

    const socketA = await connect(server.url, tokenA);

    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'audio' });

    const status = await ringing;
    assert.equal(status.reachable, false);
    // `pushed: true` es lo que impide que el llamante vea "no disponible"
    // mientras el teléfono del otro sí está sonando.
    assert.equal(status.pushed, true);

    socketA.close();
  } finally {
    restore();
    await server.close();
  }
});

test('the pending invite is delivered when the callee connects from the notification', async () => {
  const server = await startServer();
  const restore = stubPush({ sent: 1 });

  try {
    const agent = require('./helpers').app();
    const { token: tokenA, user: userA } = await registerUser(agent, { username: 'penda' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'pendb' });

    const socketA = await connect(server.url, tokenA);

    // El otro no está: se guarda la invitación.
    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'video' });
    await ringing;

    // El usuario abre la app desde la notificación: su socket conecta *después*
    // del aviso. Sin la reentrega, la llamada se perdería justo cuando el
    // teléfono acaba de sonar.
    //
    // Se escucha desde antes del handshake a propósito: el servidor emite la
    // invitación pendiente en el mismo instante en que acepta la conexión, así
    // que registrar el listener después podría perderla por una carrera.
    const socketB = ioClient(server.url, {
      auth: { token: tokenB },
      transports: ['websocket'],
      forceNew: true,
    });
    const incoming = once(socketB, 'call:incoming');
    await new Promise((resolve, reject) => {
      socketB.on('connect', resolve);
      socketB.on('connect_error', reject);
    });

    const payload = await incoming;
    assert.equal(String(payload.from.id), String(userA.id || userA._id));
    assert.equal(payload.kind, 'video');

    socketA.close();
    socketB.close();
  } finally {
    restore();
    await server.close();
  }
});

test('accepting clears the pending invite so it does not ring twice', async () => {
  const server = await startServer();
  const restore = stubPush({ sent: 1 });

  try {
    const agent = require('./helpers').app();
    const { token: tokenA, user: userA } = await registerUser(agent, { username: 'cleara' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'clearb' });
    const idA = String(userA.id || userA._id);
    const idB = String(userB.id || userB._id);

    const socketA = await connect(server.url, tokenA);
    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: idB, kind: 'audio' });
    await ringing;

    const socketB = ioClient(server.url, {
      auth: { token: tokenB },
      transports: ['websocket'],
      forceNew: true,
    });
    const pendingForB = once(socketB, 'call:incoming');
    await new Promise((resolve, reject) => {
      socketB.on('connect', resolve);
      socketB.on('connect_error', reject);
    });
    await pendingForB;

    // B acepta; la invitación pendiente debe limpiarse. Si no, al reconectar
    // B volvería a sonar una llamada que ya está en curso.
    const accepted = once(socketA, 'call:accepted');
    socketB.emit('call:accept', { to: idA });
    await accepted;

    // Una segunda conexión de B no debe recibir ninguna invitación pendiente.
    // Se escucha desde antes del handshake para no dejar una ventana en la que
    // un reenvío pasara desapercibido.
    const socketB2 = ioClient(server.url, {
      auth: { token: tokenB },
      transports: ['websocket'],
      forceNew: true,
    });
    let leaked = false;
    socketB2.once('call:incoming', () => {
      leaked = true;
    });
    await new Promise((resolve, reject) => {
      socketB2.on('connect', resolve);
      socketB2.on('connect_error', reject);
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(leaked, false, 'no debería reentregarse una invitación ya usada');

    socketA.close();
    socketB.close();
    socketB2.close();
  } finally {
    restore();
    await server.close();
  }
});
