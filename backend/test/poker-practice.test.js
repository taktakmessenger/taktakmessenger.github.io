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
const { decideBotAction, handStrength } = require('../src/games/poker/bot');

// La mesa de prácticas es la de aprender: una mesa de la casa, siempre abierta,
// con bots sentados y fichas de juguete. Lo que se comprueba aquí es que no
// toca el monedero, que los bots ocupan sus sillas y que juegan solos, porque
// de eso depende que la mesa no se quede esperando a nadie.

test.before(async () => connectTestDb());
test.beforeEach(async () => {
  await resetDb();
  poker._reset();
});
test.after(async () => disconnectTestDb());

test('la mesa de prácticas nace con los bots ya sentados', () => {
  const table = poker.getOrCreatePracticeTable();
  assert.equal(table.seats.filter(Boolean).length, 3);
  assert.ok(table.seats.filter(Boolean).every((p) => poker.isBotId(p.userId)));
});

test('entrar a prácticas no toca el monedero', async () => {
  const { user } = await registerUser(app(), { username: 'practicante' });
  await setWallet(user.id, { ttcC: 100, bonusC: 0 });
  const before = await require('../src/models/User').findById(user.id);
  poker.sitDownPractice(user.id, 'practicante');
  const after = await require('../src/models/User').findById(user.id);
  assert.equal(after.wallet.ttcC, before.wallet.ttcC);
  assert.equal(after.wallet.bonusC, before.wallet.bonusC);
  assert.notEqual(poker.practiceTable().seatOf(user.id), -1);
});

test('solo se reparte si hay una persona sentada: los bots no juegan solos', async () => {
  poker.getOrCreatePracticeTable();
  assert.equal(poker.canAutoDeal(poker.PRACTICE_HOST), false);
  const { user } = await registerUser(app(), { username: 'persona' });
  poker.sitDownPractice(user.id, 'persona');
  assert.equal(poker.canAutoDeal(poker.PRACTICE_HOST), true);
});

test('al irse la última persona, la mesa se tira', async () => {
  const { user } = await registerUser(app(), { username: 'efimera' });
  poker.sitDownPractice(user.id, 'efimera');
  assert.ok(poker.practiceTable());
  poker.standUpPractice(user.id);
  assert.equal(poker.practiceTable(), null);
});

test('los bots juegan solos hasta que la mano termina', async () => {
  const { user } = await registerUser(app(), { username: 'humano' });
  poker.sitDownPractice(user.id, 'humano');
  const table = poker.practiceTable();
  table.startHand();

  // Se juega la mano: el humano iguala siempre y los bots deciden solos. En
  // ningún momento debe quedarse el turno colgado de un bot.
  let guard = 0;
  while (table.phase !== 'showdown' && guard < 200) {
    guard += 1;
    poker.playBotTurns(poker.PRACTICE_HOST);
    const seat = table.turnSeat;
    if (seat == null) break;
    const player = table.seats[seat];
    if (!player) break;
    if (poker.isBotId(player.userId)) {
      // El turno del bot no avanzó: el bucle de bots está roto.
      throw new Error('un bot dejó el turno colgado');
    }
    const toCall = Math.max(0, table.currentBet - player.bet);
    table.act(player.userId, toCall > 0 ? 'call' : 'check');
  }
  assert.ok(guard < 200, 'la mano terminó sin colgarse');
  assert.equal(table.phase, 'showdown');
});

test('la mesa de prácticas no cobra comisión', () => {
  poker.getOrCreatePracticeTable();
  assert.equal(poker.rakeRateFor(), require('../src/config/env').poker.rake);
  // La comisión se fuerza a cero al repartir en prácticas.
  const table = poker.getOrCreatePracticeTable();
  assert.equal(table.rakeRate, 0);
});

test('el bot no se retira con una mano muy fuerte', () => {
  const table = { board: [], pot: 100, currentBet: 20, bigBlind: 10, minRaise: 10, seats: [] };
  const player = { holeCards: [{ rank: 14, suit: 's' }, { rank: 14, suit: 'h' }], bet: 0, stack: 1000 };
  table.seats[0] = player;
  assert.ok(handStrength(table, player) > 0.7);
  // Con ases en mano, muchas decisiones seguidas nunca deben ser retirarse.
  for (let i = 0; i < 50; i += 1) {
    const d = decideBotAction(table, 0);
    assert.notEqual(d.action, 'fold');
  }
});
