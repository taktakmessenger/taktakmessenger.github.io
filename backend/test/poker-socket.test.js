// POKERTAK de extremo a extremo: dos sockets reales contra un servidor real y un
// mongod real. Se comprueba lo que de verdad importa: que la entrada se cobra
// del monedero, que las cartas de cada uno solo las ve él, que una mano se puede
// jugar y que al cerrar la mesa vuelven las fichas y se liquida la comisión.

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const createApp = require('../src/app');
const { initLiveSockets } = require('../src/services/liveSockets');
const sfu = require('../src/services/sfuService');
const poker = require('../src/services/pokerService');
const Squad = require('../src/models/Squad');
const User = require('../src/models/User');
const {
  connectTestDb, resetDb, disconnectTestDb, app, registerUser, setWallet,
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
    // Los sockets de prueba mantienen la conexión abierta; sin cerrarlos a la
    // fuerza, `server.close` esperaría para siempre y ocultaría el error real.
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

// Abre la mesa y espera el primer estado. Deja el socket dentro de la sala de la
// mesa, que es requisito para que le lleguen los estados siguientes.
async function openTable(socket, slug) {
  socket.emit('poker:open', { slug });
  return nextEvent(socket, 'poker:state');
}

// Crea un creator con sala de voz para el anfitrión y devuelve su slug.
async function makeCreator(host) {
  const squad = await Squad.create({
    owner: host.user.id,
    name: 'Mesa de prueba',
    slug: 'mesa-prueba',
    visibility: 'public',
    voiceRoom: 'voice-mesa-prueba',
  });
  return squad.slug;
}

test('el anfitrión abre la mesa y dos jugadores se sientan pagando con monedas', async () => {
  const agent = app();
  const host = await registerUser(agent, { username: 'host' });
  const slug = await makeCreator(host);
  const a = await registerUser(agent, { username: 'ana' });
  const b = await registerUser(agent, { username: 'luis' });
  await setWallet(a.user.id, { ttcC: 5000, bonusC: 0 });
  await setWallet(b.user.id, { ttcC: 5000, bonusC: 0 });

  await withServer(async (url) => {
    const sh = await connect(url, host.token);
    const sa = await connect(url, a.token);
    const sb = await connect(url, b.token);

    await openTable(sh, slug);
    await openTable(sa, slug);
    sa.emit('poker:sit', { slug, buyIn: 1000 });
    const stateA = await nextEvent(sa, 'poker:state');
    assert.equal(stateA.seats.filter((s) => !s.empty).length, 1);

    await openTable(sb, slug);
    sb.emit('poker:sit', { slug, buyIn: 1000 });
    const stateB = await nextEvent(sb, 'poker:state');
    assert.equal(stateB.seats.filter((s) => !s.empty).length, 2);

    // Las cartas del otro no llegan por el socket: en la vista de Luis (que ya
    // tiene a los dos), las de Ana van ocultas.
    const other = stateB.seats.find((s) => s.userId === a.user.id);
    assert.ok(other.holeCards.every((c) => c === null), 'las cartas del rival van ocultas');

    // Mientras está sentado, la entrada ya salió de su monedero.
    const seated = await User.findById(a.user.id).select('wallet');
    assert.equal(seated.wallet.ttcC, 4000, 'se descontó la entrada');

    sh.close(); sa.close(); sb.close();
  });
});

test('una mano completa por socket termina en showdown y enseña las cartas', async () => {
  const agent = app();
  const host = await registerUser(agent, { username: 'host' });
  const slug = await makeCreator(host);
  const a = await registerUser(agent, { username: 'ana' });
  const b = await registerUser(agent, { username: 'luis' });
  await setWallet(a.user.id, { ttcC: 5000, bonusC: 0 });
  await setWallet(b.user.id, { ttcC: 5000, bonusC: 0 });

  await withServer(async (url) => {
    const sa = await connect(url, a.token);
    const sb = await connect(url, b.token);

    await openTable(sa, slug);
    sa.emit('poker:sit', { slug, buyIn: 1000 });
    await nextEvent(sa, 'poker:state');
    await openTable(sb, slug);
    sb.emit('poker:sit', { slug, buyIn: 1000 });
    await nextEvent(sb, 'poker:state');

    sa.emit('poker:start', {});
    let state = await nextEvent(sa, 'poker:state');
    assert.equal(state.phase, 'preflop');

    // Se juega con "call"/"check" hasta el final. El estado llega a los dos.
    for (let i = 0; i < 20 && state.phase !== 'showdown'; i += 1) {
      const seat = state.turnSeat;
      const player = state.seats[seat];
      const actor = String(player.userId) === String(a.user.id) ? sa : sb;
      const toCall = state.currentBet - player.bet;
      actor.emit('poker:act', { action: toCall > 0 ? 'call' : 'check' });
      state = await nextEvent(sa, 'poker:state');
    }

    assert.equal(state.phase, 'showdown');
    assert.equal(state.board.length, 5);
    assert.ok(state.winners.length >= 1);
    // En el showdown ya se ven las cartas de los dos.
    const shown = state.seats.filter((s) => !s.empty && s.holeCards.some(Boolean));
    assert.equal(shown.length, 2);

    sa.close(); sb.close();
  });
});

test('cerrar la mesa devuelve las fichas y liquida la comisión al administrador', async () => {
  const agent = app();
  const admin = await registerUser(agent, { username: 'jefe' });
  await User.updateOne({ _id: admin.user.id }, { $set: { role: 'admin' } });
  const host = await registerUser(agent, { username: 'host' });
  const slug = await makeCreator(host);
  const a = await registerUser(agent, { username: 'ana' });
  await setWallet(a.user.id, { ttcC: 5000, bonusC: 0 });

  await withServer(async (url) => {
    const sh = await connect(url, host.token);
    const sa = await connect(url, a.token);
    await openTable(sh, slug);
    await openTable(sa, slug);
    sa.emit('poker:sit', { slug, buyIn: 1000 });
    await nextEvent(sa, 'poker:state');
    // Se simula una comisión acumulada de una mano terminada.
    poker.accrueRake(String(host.user.id), { paid: 3, bonus: 0 });

    // Un jugador que no es el anfitrión no puede cerrar la mesa.
    sa.emit('poker:close', {});
    const denied = await nextEvent(sa, 'poker:error');
    assert.match(denied.error, /anfitrión/i);

    // El anfitrión sí, y el aviso llega a todos.
    sh.emit('poker:close', {});
    await nextEvent(sa, 'poker:closed');
    sh.close(); sa.close();
  });

  const aAfter = await User.findById(a.user.id).select('wallet');
  assert.equal(aAfter.wallet.ttcC, 5000, 'las fichas vuelven al monedero');
  const adminAfter = await User.findById(admin.user.id).select('wallet');
  assert.equal(adminAfter.wallet.ttcC, 3, 'el administrador cobra la comisión');
});

test('al desconectarse se devuelven las fichas al monedero', async () => {
  const agent = app();
  const host = await registerUser(agent, { username: 'host' });
  const slug = await makeCreator(host);
  const a = await registerUser(agent, { username: 'ana' });
  await setWallet(a.user.id, { ttcC: 5000, bonusC: 0 });

  await withServer(async (url) => {
    const sa = await connect(url, a.token);
    await openTable(sa, slug);
    sa.emit('poker:sit', { slug, buyIn: 1000 });
    await nextEvent(sa, 'poker:state');

    const seated = await User.findById(a.user.id).select('wallet');
    assert.equal(seated.wallet.ttcC, 4000);

    // Al cerrar el socket, el servidor debe devolver la pila.
    sa.close();
    await new Promise((resolve) => setTimeout(resolve, 600));
  });

  const after = await User.findById(a.user.id).select('wallet');
  assert.equal(after.wallet.ttcC, 5000, 'la pila vuelve al cerrar el socket');
});
