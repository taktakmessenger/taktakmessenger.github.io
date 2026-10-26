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

test('ice configuration requires a session', async () => {
  const agent = app();
  const res = await agent.get('/api/calls/ice');
  // Las credenciales de TURN permiten retransmitir tráfico por el servidor: no
  // pueden estar al alcance de un visitante anónimo.
  assert.equal(res.status, 401);
});

test('ice configuration always offers STUN so calls work on a simple network', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.get('/api/calls/ice').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.iceServers));
  assert.ok(res.body.iceServers.length > 0);

  const urls = res.body.iceServers.flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [server.urls]
  );
  assert.ok(
    urls.some((url) => String(url).startsWith('stun:')),
    'a STUN server is what lets a peer learn its own public address'
  );
});

test('without TURN the response says so, instead of implying calls cross any network', async () => {
  const agent = app();
  const { token } = await registerUser(agent);

  const res = await agent.get('/api/calls/ice').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  // El entorno de test no configura TURN, así que la bandera debe reflejarlo.
  assert.equal(res.body.hasTurn, false);
});

// ---------------------------------------------------------------------------
// Texto de la traducción en vivo de una llamada
// ---------------------------------------------------------------------------
//
// `call:speech` es el único evento de la llamada que el servidor NO reenvía a
// ciegas: el resto (oferta, respuesta, candidatos) son opacos, pero este lleva
// texto que el otro lado va a traducir y a decir en voz alta. Por eso se valida
// y se recorta antes de reenviarlo.

const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { io: ioClient } = require('socket.io-client');

async function startCallServer() {
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

// Espera un margen corto y falla si el evento llega: sirve para comprobar que
// algo NO se reenvía, que es la mitad de la seguridad de este evento.
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

test('el texto reconocido llega al otro participante de la llamada', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const delivered = onceEvent(socketB, 'call:speech');
    socketA.emit('call:speech', { to: b.user.id, text: 'hola, ¿me oyes?' });

    const payload = await delivered;
    assert.equal(payload.text, 'hola, ¿me oyes?');
    assert.equal(String(payload.from), String(a.user.id));
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('el texto se recorta al límite antes de reenviarlo', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const delivered = onceEvent(socketB, 'call:speech');
    // Sin el recorte, un cliente podría usar el servidor para mandar un texto
    // enorme al otro. El límite es 1000.
    socketA.emit('call:speech', { to: b.user.id, text: 'x'.repeat(5000) });

    const payload = await delivered;
    assert.equal(payload.text.length, 1000);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('un texto vacío o que no es cadena no se reenvía', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    socketA.emit('call:speech', { to: b.user.id, text: '   ' });
    socketA.emit('call:speech', { to: b.user.id, text: 42 });
    socketA.emit('call:speech', { to: b.user.id, text: { evil: true } });
    socketA.emit('call:speech', { to: b.user.id });

    await neverEvent(socketB, 'call:speech');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('sin destinatario, el texto no se reenvía a nadie', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    socketA.emit('call:speech', { text: 'para nadie' });

    await neverEvent(socketB, 'call:speech');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

// --- Origen de la llamada -------------------------------------------------
//
// La traducción en vivo es una función de WhaTaka, no del marcador ni del feed.
// El receptor tiene que poder distinguir de dónde salió la llamada, y ese dato
// no puede inventárselo: lo decide quien llama y el servidor lo normaliza.

test('la llamada dice si salió de WhaTaka', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const incoming = onceEvent(socketB, 'call:incoming');
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio', origin: 'whataka' });

    const payload = await incoming;
    assert.equal(payload.origin, 'whataka');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('un origen desconocido no se propaga como WhaTaka', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const incoming = onceEvent(socketB, 'call:incoming');
    // Un cliente no puede etiquetar su llamada como del chat para colar la
    // traducción donde no toca; lo que no sea exactamente `whataka` es `app`.
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio', origin: 'fake' });

    const payload = await incoming;
    assert.equal(payload.origin, 'app');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('sin origen, la llamada es del resto de la app', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const incoming = onceEvent(socketB, 'call:incoming');
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio' });

    const payload = await incoming;
    assert.equal(payload.origin, 'app');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

// --- Idioma de cada parte -------------------------------------------------
//
// Sin el idioma, la app no puede saber si hace falta traducir y tendría que
// preguntarlo en cada llamada, que es justo lo que hace que nadie use la
// función. El dato sale del perfil, no de lo que diga el cliente.

test('la invitación lleva el idioma de quien llama y el de quien recibe', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const User = require('../src/models/User');

  await User.updateOne({ _id: a.user.id }, { $set: { preferredLanguage: 'es' } });
  await User.updateOne({ _id: b.user.id }, { $set: { preferredLanguage: 'zh-Hans' } });

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const incoming = onceEvent(socketB, 'call:incoming');
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio', origin: 'whataka' });

    const payload = await incoming;
    assert.equal(payload.from.language, 'es');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('el llamante recibe el idioma del otro al timbrar', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);
  const User = require('../src/models/User');

  await User.updateOne({ _id: b.user.id }, { $set: { preferredLanguage: 'zh-Hans' } });

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const ringing = onceEvent(socketA, 'call:ringing');
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio', origin: 'whataka' });

    const payload = await ringing;
    assert.equal(payload.reachable, true);
    assert.equal(payload.language, 'zh-Hans');
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});

test('sin idioma en el perfil, no se inventa uno', async () => {
  const server = await startCallServer();
  const agent = app();
  const a = await registerUser(agent);
  const b = await registerUser(agent);

  const socketA = await connectSocket(server.url, a.token);
  const socketB = await connectSocket(server.url, b.token);

  try {
    const incoming = onceEvent(socketB, 'call:incoming');
    socketA.emit('call:invite', { to: b.user.id, kind: 'audio', origin: 'whataka' });

    const payload = await incoming;
    // `null` es la verdad: nadie ha elegido idioma. Sembrar 'es' por defecto
    // haría que la app ofreciera traducir a quien quizá no lo necesita.
    assert.equal(payload.from.language, null);
  } finally {
    socketA.close();
    socketB.close();
    await server.close();
  }
});
