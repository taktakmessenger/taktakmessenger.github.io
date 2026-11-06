const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

// A real HTTP server on an ephemeral port, so the socket path is exercised
// end to end instead of being mocked.
async function withServer(fn) {
  const server = http.createServer(createApp());
  initLiveSockets(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function nextEvent(socket, name, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${name}`)), timeoutMs);
    socket.once(name, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test('a viewer receives a message another viewer posted', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const listener = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, listener.token);
    try {
      a.emit('live:join', { room: 'sala-1' });
      b.emit('live:join', { room: 'sala-1' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      const received = nextEvent(b, 'live:message');
      a.emit('live:message', { room: 'sala-1', text: '¡Hola TAK TAK!' });

      const msg = await received;
      assert.equal(msg.text, '¡Hola TAK TAK!');
      assert.equal(msg.user, sender.username);
    } finally {
      a.close();
      b.close();
    }
  });
});

// El token es viejo: lleva el nombre que el usuario tenía al iniciar sesión. Si
// después se cambia el nombre, el chat del directo debe mostrar el nuevo (el de
// la base de datos), no el que quedó dentro del token.
test('el chat del directo muestra el nombre actual, no el del token', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const listener = await registerUser(agent);

  const User = require('../src/models/User');
  await User.updateOne({ username: sender.username }, { $set: { username: 'nombre_nuevo' } });

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, listener.token);
    try {
      a.emit('live:join', { room: 'sala-rename' });
      b.emit('live:join', { room: 'sala-rename' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      const received = nextEvent(b, 'live:message');
      a.emit('live:message', { room: 'sala-rename', text: 'hola' });

      const msg = await received;
      assert.equal(msg.user, 'nombre_nuevo', 'debe usar el nombre de la base, no el del token');
    } finally {
      a.close();
      b.close();
    }
  });
});

test('an anonymous socket cannot post messages', async () => {
  const agent = app();
  await registerUser(agent);

  await withServer(async (url) => {
    const anon = await connect(url, undefined);
    const listener = await connect(url, undefined);
    try {
      anon.emit('live:join', { room: 'sala-2' });
      listener.emit('live:join', { room: 'sala-2' });
      await nextEvent(anon, 'live:joined');
      await nextEvent(listener, 'live:joined');

      let leaked = false;
      listener.on('live:message', () => {
        leaked = true;
      });
      anon.emit('live:message', { room: 'sala-2', text: 'spam anónimo' });

      await new Promise((r) => setTimeout(r, 400));
      assert.equal(leaked, false, 'un socket sin sesión no debe poder publicar');
    } finally {
      anon.close();
      listener.close();
    }
  });
});

test('messages from one room do not leak into another', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const outsider = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, outsider.token);
    try {
      a.emit('live:join', { room: 'sala-a' });
      b.emit('live:join', { room: 'sala-b' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      let leaked = false;
      b.on('live:message', () => {
        leaked = true;
      });
      a.emit('live:message', { room: 'sala-a', text: 'solo para sala-a' });

      await new Promise((r) => setTimeout(r, 400));
      assert.equal(leaked, false, 'los mensajes no deben cruzar de sala');
    } finally {
      a.close();
      b.close();
    }
  });
});

test('a long message is truncated instead of relayed whole', async () => {
  const agent = app();
  const sender = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, sender.token);
    try {
      a.emit('live:join', { room: 'sala-c' });
      b.emit('live:join', { room: 'sala-c' });
      await nextEvent(a, 'live:joined');
      await nextEvent(b, 'live:joined');

      const received = nextEvent(b, 'live:message');
      a.emit('live:message', { room: 'sala-c', text: 'x'.repeat(1000) });

      const msg = await received;
      assert.equal(msg.text.length, 200);
    } finally {
      a.close();
      b.close();
    }
  });
});

// --- Acceso al directo y modo espectador ---------------------------------
// El nombre de la sala de un creator es público (aparece en su ficha), así que
// el chat no puede fiarse de él: `live:join` comprueba la membresía contra la
// base de datos, igual que el endpoint REST del feed.

const Squad = require('../src/models/Squad');

async function makeSquad(owner, overrides = {}) {
  const id = owner.user.id ?? owner.user._id;
  return Squad.create({
    name: 'Sala de prueba',
    slug: `sala-${Math.random().toString(36).slice(2, 8)}`,
    owner: id,
    visibility: 'private',
    members: [{ user: id, role: 'owner' }],
    voiceRoom: `squad-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  });
}

test('un extraño no puede entrar al chat de un creator privado', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const outsider = await registerUser(agent);
  const squad = await makeSquad(owner);

  await withServer(async (url) => {
    const socket = await connect(url, outsider.token);
    try {
      let joined = null;
      socket.on('live:joined', (payload) => {
        joined = payload;
      });

      const denied = nextEvent(socket, 'live:error');
      socket.emit('live:join', { room: squad.voiceRoom });
      const payload = await denied;
      assert.match(payload.error, /acceso/i);

      await new Promise((r) => setTimeout(r, 200));
      assert.equal(joined, null, 'no debe recibir el acuse de entrada');
    } finally {
      socket.close();
    }
  });
});

test('un miembro sí entra al chat de un creator privado', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const member = await registerUser(agent);
  const squad = await makeSquad(owner, { members: [
    { user: owner.user.id ?? owner.user._id, role: 'owner' },
    { user: member.user.id ?? member.user._id, role: 'member' },
  ] });

  await withServer(async (url) => {
    const socket = await connect(url, member.token);
    try {
      socket.emit('live:join', { room: squad.voiceRoom });
      const joined = await nextEvent(socket, 'live:joined');
      assert.equal(joined.room, squad.voiceRoom);
    } finally {
      socket.close();
    }
  });
});

test('solo se publica en una sala a la que se entró', async () => {
  const agent = app();
  const sender = await registerUser(agent);
  const listener = await registerUser(agent);

  await withServer(async (url) => {
    const a = await connect(url, sender.token);
    const b = await connect(url, listener.token);
    try {
      // `b` entra a la sala; `a` nunca se unió.
      b.emit('live:join', { room: 'sala-x' });
      await nextEvent(b, 'live:joined');

      let received = null;
      b.on('live:message', (msg) => {
        received = msg;
      });
      a.emit('live:message', { room: 'sala-x', text: 'colado' });

      await new Promise((r) => setTimeout(r, 300));
      assert.equal(received, null, 'quien no entró no puede publicar');
    } finally {
      a.close();
      b.close();
    }
  });
});

test('un espectador ve al anfitrión pero no se anuncia como par', async () => {
  const agent = app();
  const owner = await registerUser(agent);
  const viewer = await registerUser(agent);
  const squad = await makeSquad(owner, { visibility: 'public' });

  await withServer(async (url) => {
    const host = await connect(url, owner.token);
    const spectator = await connect(url, viewer.token);
    try {
      let announced = 0;
      host.on('voice:peer-joined', () => {
        announced += 1;
      });

      host.emit('voice:join', { slug: squad.slug, mesh: true });
      await nextEvent(host, 'voice:joined');

      const joined = nextEvent(spectator, 'voice:joined');
      spectator.emit('voice:join', { slug: squad.slug, mesh: true, spectate: true });
      const payload = await joined;
      assert.equal(payload.peers.length, 1, 'el espectador ve al que ya estaba');

      await new Promise((r) => setTimeout(r, 300));
      assert.equal(announced, 0, 'el espectador no debe anunciarse como par');
    } finally {
      host.close();
      spectator.close();
    }
  });
});
