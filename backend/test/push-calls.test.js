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

// El fallo que reportó el usuario: con la app en segundo plano, el socket sigue
// abierto, así que el servidor creía que el otro estaba disponible, emitía la
// llamada por socket y no mandaba push. El teléfono no repicaba. Ahora un
// socket que se declara oculto no cuenta como "puede sonar" y se manda push.
test('a callee with the app in the background gets a push, not a live ring', async () => {
  const server = await startServer();
  const restore = stubPush({ sent: 1 });
  let pushCalls = 0;
  let pushOptions = null;
  const realSend = pushService.sendToUser;
  pushService.sendToUser = (...args) => {
    pushCalls += 1;
    pushOptions = args[2];
    return realSend(...args);
  };

  try {
    const agent = require('./helpers').app();
    const { token: tokenA } = await registerUser(agent, { username: 'bga' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'bgb' });

    const socketA = await connect(server.url, tokenA);
    const socketB = await connect(server.url, tokenB);

    // B pasa a segundo plano: el socket sigue vivo, pero ya no puede repicar.
    socketB.emit('app:visibility', { visible: false });
    await new Promise((r) => setTimeout(r, 150));

    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'video' });
    const status = await ringing;

    // La llamada no se da por "en vivo": se despierta el teléfono con push.
    assert.equal(status.reachable, false, 'un socket oculto no puede repicar');
    assert.equal(status.pushed, true, 'debe sonar por push aunque el socket esté abierto');
    assert.equal(pushCalls, 1, 'el push tiene que enviarse aunque haya socket oculto');
    // Urgencia alta: sin esto Android aplaza el push en reposo y la llamada
    // llega cuando ya caducó, que es el "no repica" reportado.
    assert.equal(pushOptions?.urgency, 'high', 'la llamada debe enviarse con urgencia alta');
    assert.ok(pushOptions?.TTL > 0, 'debe llevar un TTL para no sonar cuando ya venció');

    socketA.close();
    socketB.close();
  } finally {
    restore();
    await server.close();
  }
});

// Al volver al primer plano, la invitación que se mandó por push se reentrega
// en vivo: así suena en la app sin depender de que el usuario pulse la
// notificación, que es como se comporta WhatsApp.
test('the pending invite is delivered when the app returns to the foreground', async () => {
  const server = await startServer();
  const restore = stubPush({ sent: 1 });

  try {
    const agent = require('./helpers').app();
    const { token: tokenA } = await registerUser(agent, { username: 'fga' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'fgb' });

    const socketA = await connect(server.url, tokenA);
    const socketB = await connect(server.url, tokenB);
    socketB.emit('app:visibility', { visible: false });
    await new Promise((r) => setTimeout(r, 150));

    // A llama con B en segundo plano: se manda push y se guarda la invitación.
    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'audio' });
    const status = await ringing;
    assert.equal(status.pushed, true);

    // B vuelve al primer plano: la invitación pendiente llega a su socket.
    const incoming = once(socketB, 'call:incoming');
    socketB.emit('app:visibility', { visible: true });
    const payload = await incoming;
    assert.equal(payload.kind, 'audio');

    socketA.close();
    socketB.close();
  } finally {
    restore();
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// Timbre continuo
//
// Un push suelto suena una vez y se acabó: no "repica". WhatsApp repica hasta
// que contestas. Estos tests comprueban que el servidor reenvía el aviso
// mientras la llamada siga viva, que el payload pide renotify (sin él Android
// reemplaza la notificación en silencio) y que el timbre se para al colgar o
// cuando el receptor vuelve a la app.
// ---------------------------------------------------------------------------

const liveSockets = require('../src/services/liveSockets');

// Recoge cada envío de push (payload y opciones) para poder inspeccionarlos.
function capturePush({ sent = 1 } = {}) {
  const original = {
    isConfigured: pushService.isConfigured,
    sendToUser: pushService.sendToUser,
  };
  const calls = [];
  pushService.isConfigured = () => true;
  pushService.sendToUser = async (_userId, payload, options) => {
    calls.push({ payload, options });
    return { sent, total: sent };
  };
  return {
    calls,
    restore() {
      pushService.isConfigured = original.isConfigured;
      pushService.sendToUser = original.sendToUser;
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('una llamada a alguien sin conexión sigue timbrando, no suena una sola vez', async () => {
  // Intervalo corto para no esperar 5 s reales por reenvío.
  process.env.CALL_RING_INTERVAL_MS = '60';
  const server = await startServer();
  const capture = capturePush({ sent: 1 });

  try {
    const agent = require('./helpers').app();
    const { token: tokenA } = await registerUser(agent, { username: 'ringa' });
    const { user: userB } = await registerUser(agent, { username: 'ringb' });

    const socketA = await connect(server.url, tokenA);
    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'audio' });
    await ringing;

    // El primer envío es inmediato; después deben venir reenvíos del timbre.
    assert.ok(capture.calls.length >= 1, 'debe mandar el push inicial');
    await wait(250);
    assert.ok(
      capture.calls.length >= 2,
      `debe reenviar el timbre (envíos=${capture.calls.length})`
    );
    // Y todos piden urgencia alta: es lo que despierta el teléfono en reposo.
    assert.equal(capture.calls[0].options.urgency, 'high');

    // Al colgar, el timbre se para: no puede seguir sonando una llamada muerta.
    const before = capture.calls.length;
    socketA.emit('call:end', { to: String(userB.id || userB._id) });
    await wait(250);
    assert.ok(
      capture.calls.length - before <= 1,
      `el timbre debe parar al colgar (envíos extra=${capture.calls.length - before})`
    );

    socketA.close();
  } finally {
    delete process.env.CALL_RING_INTERVAL_MS;
    liveSockets.stopAllRinging();
    capture.restore();
    await server.close();
  }
});

test('el payload de llamada pide renotify para que cada reenvío vuelva a sonar', () => {
  const payload = pushService.incomingCallPayload({
    from: { id: 'abc', username: 'quien' },
    kind: 'video',
    conversationId: null,
  });
  // Sin `renotify` (y su `tag`), Android reemplaza la notificación en silencio:
  // el teléfono se queda mudo tras el primer pitido y parece que no repica.
  assert.equal(payload.renotify, true);
  assert.ok(payload.tag, 'renotify sin tag no hace nada');
  assert.equal(payload.requireInteraction, true);
});

test('el timbre se para cuando el receptor vuelve a la app (suena dentro, no por push)', async () => {
  process.env.CALL_RING_INTERVAL_MS = '60';
  const server = await startServer();
  const capture = capturePush({ sent: 1 });

  try {
    const agent = require('./helpers').app();
    const { token: tokenA } = await registerUser(agent, { username: 'visA' });
    const { token: tokenB, user: userB } = await registerUser(agent, { username: 'visB' });

    const socketA = await connect(server.url, tokenA);
    // B tiene el socket abierto pero en segundo plano: la llamada va por push.
    const socketB = await connect(server.url, tokenB);
    socketB.emit('app:visibility', { visible: false });

    const ringing = once(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: String(userB.id || userB._id), kind: 'audio' });
    await ringing;

    await wait(250);
    assert.ok(capture.calls.length >= 2, 'el timbre debe estar en marcha');

    // B vuelve al frente: recibe la invitación en vivo y el push debe parar para
    // no sonar dos veces.
    const incoming = once(socketB, 'call:incoming');
    socketB.emit('app:visibility', { visible: true });
    await incoming;

    const before = capture.calls.length;
    await wait(250);
    assert.ok(
      capture.calls.length - before <= 1,
      `tras volver a la app no debe seguir el push (extra=${capture.calls.length - before})`
    );

    socketA.close();
    socketB.close();
  } finally {
    delete process.env.CALL_RING_INTERVAL_MS;
    liveSockets.stopAllRinging();
    capture.restore();
    await server.close();
  }
});

