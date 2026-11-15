const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  registerUser,
  setWallet,
  app,
} = require('./helpers');
const User = require('../src/models/User');
const Squad = require('../src/models/Squad');
const Transaction = require('../src/models/Transaction');
const PokerEvent = require('../src/models/PokerEvent');
const pokerEvents = require('../src/services/pokerEventService');

// Los torneos se prueban contra un mongod real: la entrada, el premio y la
// devolución pasan por el monedero de verdad, y el reparto por la aritmética de
// `games/poker/prize`. Lo que importa es que el dinero cuadre y que no se pueda
// cobrar ni pagar dos veces.

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function makeUser(name, coins) {
  const { user } = await registerUser(app(), { username: name });
  await setWallet(user.id, { ttcC: coins, bonusC: 0 });
  return user;
}

async function makeSquad(owner, slug) {
  return Squad.create({ name: slug, slug, owner: owner.id, visibility: 'private', voiceRoom: `room-${slug}` });
}

test('crear un torneo no cobra nada y guarda el reparto prometido', async () => {
  const admin = await makeUser('jefe', 0);
  await makeSquad(admin, 'mesa-uno');
  const event = await pokerEvents.createEvent({
    title: 'Torneo del viernes',
    adminId: admin.id,
    squadSlug: 'mesa-uno',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    entryCost: 100,
    maxPlayers: 9,
  });

  assert.equal(event.status, 'scheduled');
  assert.equal(event.players.length, 0);
  assert.deepEqual([...event.split], [0.4, 0.3, 0.2]);
  assert.equal(event.rakeRate, 0.1);
  // Con el aforo lleno, la previsión es 900 de bruto, 810 de bote y 40/30/20.
  const view = pokerEvents.publicEvent(event);
  assert.equal(view.projectedPrizePool, 810);
  assert.deepEqual(view.projectedPlaces.map((p) => p.amount), [360, 270, 180]);
});

test('inscribirse cobra la entrada y no deja inscribirse dos veces', async () => {
  const admin = await makeUser('jefe', 0);
  await makeSquad(admin, 'mesa-dos');
  const event = await pokerEvents.createEvent({
    title: 'Torneo',
    adminId: admin.id,
    squadSlug: 'mesa-dos',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    entryCost: 100,
    maxPlayers: 9,
  });
  const ana = await makeUser('ana', 500);

  await pokerEvents.joinEvent({ eventId: event._id, userId: ana.id, username: 'ana' });
  const after = await User.findById(ana.id).select('wallet');
  assert.equal(after.wallet.ttcC, 400, 'se descontó la entrada');

  await assert.rejects(
    () => pokerEvents.joinEvent({ eventId: event._id, userId: ana.id, username: 'ana' }),
    /Ya estás inscrito/
  );
});

test('no deja inscribirse sin monedas ni con el torneo lleno', async () => {
  const admin = await makeUser('jefe', 0);
  await makeSquad(admin, 'mesa-tres');
  const event = await pokerEvents.createEvent({
    title: 'Torneo corto',
    adminId: admin.id,
    squadSlug: 'mesa-tres',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    entryCost: 100,
    maxPlayers: 2,
  });
  const pobre = await makeUser('pobre', 50);
  await assert.rejects(
    () => pokerEvents.joinEvent({ eventId: event._id, userId: pobre.id, username: 'pobre' }),
    /Monedas insuficientes/
  );

  const a = await makeUser('aaa', 500);
  const b = await makeUser('bbb', 500);
  const c = await makeUser('ccc', 500);
  await pokerEvents.joinEvent({ eventId: event._id, userId: a.id, username: 'aaa' });
  await pokerEvents.joinEvent({ eventId: event._id, userId: b.id, username: 'bbb' });
  await assert.rejects(
    () => pokerEvents.joinEvent({ eventId: event._id, userId: c.id, username: 'ccc' }),
    /lleno/
  );
});

test('cerrar el torneo paga 40/30/20 y acredita la tarifa al administrador', async () => {
  const admin = await makeUser('jefe', 0);
  await makeSquad(admin, 'mesa-cuatro');
  const event = await pokerEvents.createEvent({
    title: 'Torneo de premios',
    adminId: admin.id,
    squadSlug: 'mesa-cuatro',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    entryCost: 100,
    maxPlayers: 9,
  });
  const players = [];
  for (const name of ['uno', 'dos', 'tres', 'cuatro']) {
    const u = await makeUser(name, 500);
    players.push(u);
    await pokerEvents.joinEvent({ eventId: event._id, userId: u.id, username: name });
  }
  // Con 4 inscritos: bruto 400, tarifa 40, bote 360 -> 160 / 120 / 80.
  const running = await PokerEvent.findById(event._id);
  running.status = 'running';
  await running.save();

  const result = await pokerEvents.finishEvent({
    eventId: event._id,
    ranking: [players[0].id, players[1].id, players[2].id, players[3].id],
  });

  assert.equal(result.payout.prizePool, 360);
  assert.deepEqual(
    result.event.results.map((r) => r.amount),
    [160, 120, 80]
  );

  const w1 = await User.findById(players[0].id).select('wallet');
  assert.equal(w1.wallet.ttcC, 400 + 160, 'el primero cobra su premio');
  const w3 = await User.findById(players[2].id).select('wallet');
  assert.equal(w3.wallet.ttcC, 400 + 80, 'el tercero cobra el suyo');

  const adminAfter = await User.findById(admin.id).select('wallet');
  assert.equal(adminAfter.wallet.ttcC, 40, 'la casa se lleva el 10% del bruto');

  // Cerrar dos veces no paga dos veces.
  const again = await pokerEvents.finishEvent({ eventId: event._id, ranking: [] });
  assert.equal(again.already, true);
  const w1Again = await User.findById(players[0].id).select('wallet');
  assert.equal(w1Again.wallet.ttcC, 560, 'no se vuelve a pagar');

  const entries = await Transaction.countDocuments({ type: 'poker_event_prize' });
  assert.equal(entries, 3, 'hay un asiento por premio');
});

test('cancelar devuelve la entrada a todos en el mismo tipo de moneda', async () => {
  const admin = await makeUser('jefe', 0);
  await makeSquad(admin, 'mesa-cinco');
  const event = await pokerEvents.createEvent({
    title: 'Torneo cancelado',
    adminId: admin.id,
    squadSlug: 'mesa-cinco',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    entryCost: 100,
    maxPlayers: 9,
  });
  // Uno paga con monedas pagadas y otro con regalo.
  const pagado = await makeUser('pagado', 500);
  const regalo = await makeUser('regalo', 0);
  await setWallet(regalo.id, { ttcC: 0, bonusC: 500 });
  await pokerEvents.joinEvent({ eventId: event._id, userId: pagado.id, username: 'pagado' });
  await pokerEvents.joinEvent({ eventId: event._id, userId: regalo.id, username: 'regalo' });

  await pokerEvents.cancelEvent({ eventId: event._id, reason: 'falta gente' });

  const p = await User.findById(pagado.id).select('wallet');
  const r = await User.findById(regalo.id).select('wallet');
  assert.equal(p.wallet.ttcC, 500, 'al que pagó con monedas pagadas se le devuelven pagadas');
  assert.equal(p.wallet.bonusC, 0);
  assert.equal(r.wallet.bonusC, 500, 'al que pagó con regalo se le devuelve regalo');
  assert.equal(r.wallet.ttcC, 0, 'el regalo no se convierte en dinero');

  const refunds = await Transaction.countDocuments({ type: 'poker_event_refund' });
  assert.equal(refunds, 2);
});

test('el aforo debe estar entre 2 y 9 y la entrada debe ser positiva', async () => {
  const admin = await makeUser('jefe', 0);
  await makeSquad(admin, 'mesa-seis');
  const base = {
    title: 'X',
    adminId: admin.id,
    squadSlug: 'mesa-seis',
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
  };
  await assert.rejects(() => pokerEvents.createEvent({ ...base, entryCost: 100, maxPlayers: 10 }), /2 y 9/);
  await assert.rejects(() => pokerEvents.createEvent({ ...base, entryCost: 0, maxPlayers: 9 }), /mayor que cero/);
  await assert.rejects(() => pokerEvents.createEvent({ ...base, entryCost: 100, maxPlayers: 9, squadSlug: 'no-existe' }), /No existe esa sala/);
});
