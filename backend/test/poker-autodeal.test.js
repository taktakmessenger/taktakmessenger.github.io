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
const poker = require('../src/services/pokerService');

// El reparto automático es lo que evita que la mesa se quede en "esperando tu
// turno": con dos jugadores con fichas, entre manos, la mesa baraja sola. Aquí se
// comprueba el planificador sin depender de que el socket esté conectado.

test.before(async () => connectTestDb());
test.beforeEach(async () => {
  await resetDb();
  poker._reset();
});
test.after(async () => disconnectTestDb());

async function makeUser(name, coins) {
  const { user } = await registerUser(app(), { username: name });
  await setWallet(user.id, { ttcC: coins, bonusC: 0 });
  return user;
}

test('con dos jugadores sentados la mesa puede repartir sola', async () => {
  const host = 'host-auto';
  const a = await makeUser('ana', 1000);
  const b = await makeUser('luis', 1000);
  await poker.sitDown(host, a.id, 'ana', 500);
  await poker.sitDown(host, b.id, 'luis', 500);

  assert.equal(poker.canAutoDeal(host), true);
});

test('con un solo jugador no reparte: haría una mano imposible', async () => {
  const host = 'host-solo';
  const a = await makeUser('ana', 1000);
  await poker.sitDown(host, a.id, 'ana', 500);

  assert.equal(poker.canAutoDeal(host), false);
  let dealt = false;
  poker.scheduleAutoDeal(host, () => { dealt = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(dealt, false, 'no se reparte con un solo jugador');
});

test('entre manos, el reparto programado arranca la mano y avisa una vez', async () => {
  const host = 'host-plan';
  const a = await makeUser('ana', 1000);
  const b = await makeUser('luis', 1000);
  await poker.sitDown(host, a.id, 'ana', 500);
  await poker.sitDown(host, b.id, 'luis', 500);

  let deals = 0;
  const scheduled = poker.scheduleAutoDeal(host, () => { deals += 1; });
  assert.equal(scheduled, true);

  // Un segundo plan no se duplica: la mesa baraja una sola vez.
  poker.scheduleAutoDeal(host, () => { deals += 1; });

  await new Promise((r) => setTimeout(r, poker.AUTO_DEAL_WAIT_MS + 300));
  assert.equal(deals, 1, 'solo se reparte una vez');
  const table = poker.getTable(host);
  assert.equal(table.phase, 'preflop', 'la mano ya está en juego');
  assert.equal(table.handNumber, 1);
});

test('con la mano en juego no se programa otro reparto', async () => {
  const host = 'host-medio';
  const a = await makeUser('ana', 1000);
  const b = await makeUser('luis', 1000);
  await poker.sitDown(host, a.id, 'ana', 500);
  await poker.sitDown(host, b.id, 'luis', 500);
  poker.startHand(host);

  assert.equal(poker.canAutoDeal(host), false);
});

test('al cerrar la mesa se cancela el reparto pendiente', async () => {
  const host = 'host-cierre';
  const a = await makeUser('ana', 1000);
  const b = await makeUser('luis', 1000);
  await poker.sitDown(host, a.id, 'ana', 500);
  await poker.sitDown(host, b.id, 'luis', 500);
  poker.scheduleAutoDeal(host, () => {});

  await poker.closeTable(host);
  // Ya no hay mesa: aunque el temporizador disparara, no habría nada que barajar.
  assert.equal(poker.getTable(host), null);
});
