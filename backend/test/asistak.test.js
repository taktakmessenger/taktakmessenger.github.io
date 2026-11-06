// Asistak: moderación de directos y de la sala de juegos.
//
// Se prueba lo que importa sin depender de la red: el juicio local (que es el
// suelo que funciona sin clave), la escalada de aviso a suspensión, y que un
// usuario suspendido no pueda entrar ni al directo ni a la mesa.

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const sfu = require('../src/services/sfuService');
const poker = require('../src/services/pokerService');
const asistak = require('../src/services/asistakService');
const User = require('../src/models/User');
const Squad = require('../src/models/Squad');
const {
  connectTestDb, resetDb, disconnectTestDb, app, registerUser,
} = require('./helpers');

test.before(async () => connectTestDb());
test.beforeEach(async () => { await resetDb(); poker._reset(); });
test.after(async () => {
  await sfu.shutdown().catch(() => {});
  await disconnectTestDb();
});

async function withServer(fn) {
  const server = http.createServer(createApp());
  initLiveSockets(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(url);
  } finally {
    server.closeAllConnections?.();
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

function nextEvent(socket, name, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${name}`)), timeoutMs);
    socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

/* ----------------------------- juicio local ----------------------------- */

test('el léxico local marca un insulto claro como ofensa grave', () => {
  assert.equal(asistak.localSeverity('eres un hijo de puta'), asistak._severity.HARD);
  assert.equal(asistak.localSeverity('CÁLLATE, idiota'), asistak._severity.HARD);
});

test('el léxico local distingue una queja de un insulto', () => {
  // "mierda" aparece, pero sin destinatario: aun así el léxico la marca. La
  // capa de IA es la que puede rebajarla; aquí se comprueba que la palabra
  // suelta no pasa como "nada" y que una frase limpia sí.
  assert.equal(asistak.localSeverity('vaya mano de mierda'), asistak._severity.HARD);
  assert.equal(asistak.localSeverity('buena mano, enhorabuena'), asistak._severity.NONE);
  assert.equal(asistak.localSeverity('¿subes o pasas?'), asistak._severity.NONE);
});

test('las tildes y las mayúsculas no esquivan el filtro', () => {
  assert.equal(asistak.localSeverity('PÚTA'), asistak._severity.HARD);
  assert.equal(asistak.localSeverity('gilipollas'), asistak._severity.HARD);
});

test('sin clave del asistente, el juicio local sigue decidiendo', async () => {
  // En los tests no hay ASSISTANT_API_KEY, así que `aiJudge` devuelve null y
  // `assess` se apoya solo en el léxico.
  const verdict = await asistak.assess('eres un pendejo');
  assert.equal(verdict.offense, true);
  assert.ok(verdict.severity >= 1);

  const clean = await asistak.assess('hola, buenas noches a todos');
  assert.equal(clean.offense, false);
});

/* --------------------------- escalada y estado -------------------------- */

test('el primer aviso no suspende; el segundo sí', async () => {
  const agent = app();
  const { user } = await registerUser(agent);

  const first = await asistak.applyVerdict({ userId: user.id, severity: 1 });
  assert.equal(first.action, 'warn');
  assert.equal(first.warnings, 1);

  let doc = await User.findById(user.id);
  assert.equal(doc.isSuspended(), false);

  const second = await asistak.applyVerdict({ userId: user.id, severity: 1 });
  assert.equal(second.action, 'suspend');

  doc = await User.findById(user.id);
  assert.equal(doc.isSuspended(), true);
  assert.equal(doc.moderation.suspendedBy, 'asistak');
});

test('la suspensión caducada ya no cuenta', async () => {
  const agent = app();
  const { user } = await registerUser(agent);
  await User.updateOne(
    { _id: user.id },
    { $set: { 'moderation.suspendedUntil': new Date(Date.now() - 1000) } }
  );
  const doc = await User.findById(user.id);
  assert.equal(doc.isSuspended(), false);
  const access = await asistak.checkAccess(user.id);
  assert.equal(access.allowed, true);
});

test('suspender y levantar a mano', async () => {
  const agent = app();
  const { user } = await registerUser(agent);

  const result = await asistak.suspendUser({ userId: user.id, days: 5, reason: 'prueba' });
  assert.equal(result.days, 5);
  assert.equal((await asistak.checkAccess(user.id)).allowed, false);

  await asistak.liftSuspension(user.id);
  assert.equal((await asistak.checkAccess(user.id)).allowed, true);
});

/* ------------------------ bloqueo en los sockets ------------------------ */

test('un usuario suspendido no entra a la sala de voz del directo', async () => {
  const agent = app();
  const { user, token } = await registerUser(agent);
  await Squad.create({
    name: 'Creador',
    slug: 'creador',
    owner: user.id,
    voiceRoom: 'sala-1',
    visibility: 'public',
  });

  await asistak.suspendUser({ userId: user.id, days: 3, reason: 'prueba' });

  await withServer(async (url) => {
    const socket = await connect(url, token);
    const errored = nextEvent(socket, 'voice:error');
    socket.emit('voice:join', { slug: 'creador' });
    const err = await errored;
    assert.match(err.error, /suspendido/i);
    socket.close();
  });
});

test('un usuario suspendido no abre la mesa de póker', async () => {
  const agent = app();
  const { user, token } = await registerUser(agent);
  await Squad.create({
    name: 'Creador',
    slug: 'creador2',
    owner: user.id,
    voiceRoom: 'sala-2',
    visibility: 'public',
  });

  await asistak.suspendUser({ userId: user.id, days: 3, reason: 'prueba' });

  await withServer(async (url) => {
    const socket = await connect(url, token);
    const errored = nextEvent(socket, 'poker:error');
    socket.emit('poker:open', { slug: 'creador2' });
    const err = await errored;
    assert.match(err.error, /suspendido/i);
    socket.close();
  });
});

test('un insulto en el chat del directo saca el aviso de Asistak', async () => {
  const agent = app();
  const { user, token } = await registerUser(agent);
  await Squad.create({
    name: 'Creador',
    slug: 'creador3',
    owner: user.id,
    voiceRoom: 'sala-3',
    visibility: 'public',
  });

  await withServer(async (url) => {
    const socket = await connect(url, token);
    // El chat solo acepta mensajes en salas a las que el socket se unió: se
    // entra por `live:join` como haría el cliente real.
    const joined = nextEvent(socket, 'live:joined');
    socket.emit('live:join', { room: 'sala-3' });
    await joined;

    const warning = new Promise((resolve) => {
      socket.on('live:message', (msg) => {
        if (msg.asistak) resolve(msg);
      });
    });

    socket.emit('live:message', { room: 'sala-3', text: 'eres un idiota' });

    const msg = await warning;
    assert.match(msg.text, /Asistak/);
    assert.equal(msg.system, true);

    // El aviso quedó contado en la cuenta.
    const doc = await User.findById(user.id);
    assert.equal(doc.moderation.warnings, 1);
    socket.close();
  });
});

test('un segundo insulto suspende y anuncia la suspensión', async () => {
  const agent = app();
  const { user, token } = await registerUser(agent);
  await Squad.create({
    name: 'Creador',
    slug: 'creador4',
    owner: user.id,
    voiceRoom: 'sala-4',
    visibility: 'public',
  });

  // Ya traía un aviso: este segundo comentario suspende.
  await asistak.applyVerdict({ userId: user.id, severity: 1 });

  await withServer(async (url) => {
    const socket = await connect(url, token);
    const joined = nextEvent(socket, 'live:joined');
    socket.emit('live:join', { room: 'sala-4' });
    await joined;

    const messages = [];
    socket.on('live:message', (msg) => { if (msg.asistak) messages.push(msg); });

    socket.emit('live:message', { room: 'sala-4', text: 'gilipollas' });

    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.ok(messages.length >= 2, 'aviso y suspensión');
    assert.match(messages[messages.length - 1].text, /suspendido/i);

    const doc = await User.findById(user.id);
    assert.equal(doc.isSuspended(), true);
    socket.close();
  });
});
