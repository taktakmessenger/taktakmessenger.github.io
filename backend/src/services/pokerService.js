// Sala de POKERTAK: la capa que une el motor de póker con el monedero.
//
// El motor (`games/poker/pokerTable`) trabaja con fichas y no sabe nada de
// dinero. Aquí es donde las fichas se compran con monedas de la app al sentarse
// y se devuelven al levantarse, y donde la comisión de la casa (el
// administrador) se apunta en el libro de transacciones.
//
// Cada usuario tiene su propia sala privada: se identifica por el `hostId` (el
// anfitrión del directo). Las mesas viven en memoria, como las salas de voz: no
// sobreviven a un reinicio, y eso es aceptable porque una partida es efímera.

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const { PokerTable } = require('../games/poker/pokerTable');
const { decideBotAction } = require('../games/poker/bot');
const wallet = require('./walletService');

// Mesas abiertas: `tableId -> PokerTable`. El id es el del anfitrión.
const tables = new Map();

// La mesa de prácticas no es de nadie: es una mesa de la casa, siempre abierta,
// donde se juega contra bots con fichas de juguete. Se identifica con este
// anfitrión fijo para reutilizar toda la maquinaria de la mesa normal (estado,
// turnos, reparto automático) sin tocar el monedero.
const PRACTICE_HOST = 'practice';
const PRACTICE_BOT_PREFIX = 'bot:';
const PRACTICE_BOT_NAMES = ['Ana', 'Bruno', 'Carla', 'Dani', 'Eva', 'Fran'];

// Cuánto se ha recaudado en cada mesa y quién debe recibirlo. La comisión no se
// paga mano a mano (serían cientos de micro-transacciones): se acumula y se
// liquida al cerrar la sala.
const rakeAccrual = new Map(); // tableId -> { paid, bonus, hands }

// Reparto automático de manos. Entre manos, si hay dos o más jugadores con
// fichas, la mesa reparte sola: nadie se queda mirando "esperando tu turno"
// porque el anfitrión no pulse el botón, y quien se sienta a mitad de una mano
// entra en la siguiente sin que nadie haga nada.
//
// Tras un showdown se espera un poco más, para que dé tiempo a ver quién ganó y
// con qué mano antes de barajar de nuevo.
const AUTO_DEAL_WAIT_MS = 2000;
const AUTO_DEAL_AFTER_SHOWDOWN_MS = 5000;
const autoDealTimers = new Map(); // tableId -> timeout

function tableIdFor(hostId) {
  return `poker:${hostId}`;
}

function getOrCreateTable(hostId) {
  if (isPractice(hostId)) return getOrCreatePracticeTable();
  const id = tableIdFor(hostId);
  let table = tables.get(id);
  if (!table) {
    table = new PokerTable({
      id,
      maxSeats: env.poker.maxSeats,
      smallBlind: env.poker.smallBlind,
      bigBlind: env.poker.bigBlind,
      minBuyIn: env.poker.minBuyIn,
      maxBuyIn: env.poker.maxBuyIn,
      rakeRate: env.poker.rake,
    });
    table.hostId = String(hostId);
    tables.set(id, table);
    rakeAccrual.set(id, { paid: 0, bonus: 0, hands: 0 });
  }
  return table;
}

function getTable(hostId) {
  return tables.get(tableIdFor(hostId)) || null;
}

/* ------------------------------------------------------------------ */
/* Mesa de prácticas: bots, sin monedero                              */
/* ------------------------------------------------------------------ */

function isPractice(hostId) {
  return String(hostId) === PRACTICE_HOST;
}

function isBotId(userId) {
  return String(userId).startsWith(PRACTICE_BOT_PREFIX);
}

// Mesa de prácticas: fichas de juguete, sin comisión y con bots ya sentados.
function getOrCreatePracticeTable() {
  let table = tables.get(tableIdFor(PRACTICE_HOST));
  if (table) return table;
  const cfg = env.poker.practice;
  table = new PokerTable({
    id: tableIdFor(PRACTICE_HOST),
    maxSeats: cfg.seats,
    smallBlind: env.poker.smallBlind,
    bigBlind: env.poker.bigBlind,
    minBuyIn: cfg.buyIn,
    maxBuyIn: cfg.buyIn,
    rakeRate: 0,
  });
  table.hostId = PRACTICE_HOST;
  tables.set(tableIdFor(PRACTICE_HOST), table);
  for (let i = 0; i < cfg.botCount; i += 1) {
    table.sitDown(`${PRACTICE_BOT_PREFIX}${i}`, PRACTICE_BOT_NAMES[i % PRACTICE_BOT_NAMES.length], cfg.botStack);
  }
  return table;
}

// Sienta a una persona en la mesa de prácticas. No cobra nada: las fichas son
// de juguete y se van con él al levantarse.
function sitDownPractice(userId, username) {
  const table = getOrCreatePracticeTable();
  if (table.seatOf(userId) !== -1) return table;
  const open = table.seats.findIndex((s) => s === null);
  if (open === -1) throw new Error('La mesa de prácticas está llena');
  table.sitDown(userId, username, env.poker.practice.buyIn);
  return table;
}

function standUpPractice(userId) {
  const table = getTable(PRACTICE_HOST);
  if (!table) return;
  if (table.seatOf(userId) === -1) return;
  table.standUp(userId);
  // Sin ninguna persona sentada, la mesa se tira: si no, los bots seguirían
  // con sus fichas y la próxima visita encontraría la partida a medias.
  if (!table.players().some((p) => !isBotId(p.userId))) {
    cancelAutoDeal(PRACTICE_HOST);
    tables.delete(tableIdFor(PRACTICE_HOST));
  }
}

// ¿Le toca a un bot? Solo en su turno, con la mano en juego y sin haberse
// retirado. Se comprueba antes de cada jugada porque el turno cambia solo con
// las acciones de los demás.
function botToAct(hostId) {
  const table = getTable(hostId);
  if (!table) return null;
  if (table.phase === 'waiting' || table.phase === 'showdown') return null;
  const seat = table.turnSeat;
  if (seat == null) return null;
  const player = table.seats[seat];
  if (!player || !isBotId(player.userId)) return null;
  if (player.folded || player.allIn) return null;
  return seat;
}

/**
 * Juega el turno de un bot y devuelve el número de acciones aplicadas, para que
 * quien llama pueda seguir emitiendo estado. El bot decide con la misma
 * información que un jugador de la mesa (su mano y lo que se ve), así que se
 * reutiliza `table.act`.
 */
function playBotTurn(hostId) {
  const seat = botToAct(hostId);
  if (seat == null) return 0;
  const table = getTable(hostId);
  const decision = decideBotAction(table, seat);
  table.act(table.seats[seat].userId, decision.action, decision.amount);
  return 1;
}

// Los bots del turno actual, uno por uno. Se limita el número de pasos por si un
// bot jugara sin que el turno avance: nunca debe colgar el bucle del servidor.
function playBotTurns(hostId, maxSteps = 12) {
  let steps = 0;
  while (steps < maxSteps && playBotTurn(hostId) > 0) steps += 1;
  return steps;
}

function practiceTable() {
  return getTable(PRACTICE_HOST);
}

/* ------------------------------------------------------------------ */

// La comisión es un 1% fijo de cada bote, en todas las manos.
function rakeRateFor() {
  return env.poker.rake;
}

/**
 * Empieza una mano nueva con la comisión que le toca. Es el único camino por el
 * que debe arrancar una mano, para que la tarifa nunca se quede en la de la
 * mano anterior.
 */
function startHand(hostId) {
  const table = getOrCreateTable(hostId);
  // La mesa de prácticas no cobra comisión: es para aprender, no para recaudar.
  table.rakeRate = isPractice(hostId) ? 0 : rakeRateFor();
  return table.startHand();
}

/**
 * ¿Toca repartir solo? Solo entre manos (esperando o tras el showdown) y con al
 * menos dos jugadores con fichas: si no, la mesa se quedaría dando cartas a uno
 * solo o pisando una mano en curso.
 */
function canAutoDeal(hostId) {
  const table = getTable(hostId);
  if (!table) return false;
  if (table.phase !== 'waiting' && table.phase !== 'showdown') return false;
  const withChips = table.players().filter((p) => p.stack > 0);
  if (withChips.length < 2) return false;
  // La mesa de prácticas solo baraja cuando hay una persona sentada: si no, los
  // bots se repartirían manos entre ellos sin nadie mirando.
  if (isPractice(hostId) && !withChips.some((p) => !isBotId(p.userId))) return false;
  return true;
}

/**
 * Programa el reparto automático de la siguiente mano. `onDeal` se llama cuando
 * la mano ya ha arrancado, para que la capa de sockets vuelva a emitir el estado.
 *
 * Si ya hay un reparto programado no se duplica: da igual cuántos jugadores se
 * sienten seguidos, la mesa baraja una sola vez.
 */
function scheduleAutoDeal(hostId, onDeal) {
  if (!canAutoDeal(hostId)) return false;
  const id = tableIdFor(hostId);
  if (autoDealTimers.has(id)) return true;
  const table = getTable(hostId);
  const delay = table.phase === 'showdown' ? AUTO_DEAL_AFTER_SHOWDOWN_MS : AUTO_DEAL_WAIT_MS;
  const timer = setTimeout(() => {
    autoDealTimers.delete(id);
    if (!canAutoDeal(hostId)) return;
    try {
      startHand(hostId);
    } catch {
      return;
    }
    if (typeof onDeal === 'function') onDeal();
  }, delay);
  // No mantiene vivo el proceso por sí solo: el servidor HTTP ya lo hace.
  timer.unref?.();
  autoDealTimers.set(id, timer);
  return true;
}

function cancelAutoDeal(hostId) {
  const id = tableIdFor(hostId);
  const timer = autoDealTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    autoDealTimers.delete(id);
  }
}

/**
 * Sienta a un usuario: cobra la entrada de su monedero y la convierte en fichas.
 *
 * El débito y la creación del asiento no pueden quedar a medias: si el asiento
 * falla después de cobrar, se devuelve el dinero. Se cobra con `debitSpendable`,
 * que gasta primero las monedas pagadas; la composición del cobro se guarda en
 * el asiento para poder devolver cada tipo de moneda a su cubo al levantarse.
 */
async function sitDown(hostId, userId, username, buyIn) {
  const table = getOrCreateTable(hostId);
  const amount = Number(buyIn);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Entrada inválida');

  // El asiento se valida antes de cobrar para no dejar al usuario sin monedas
  // por una mesa llena o una entrada fuera de rango.
  table.sitDown(userId, username, amount, { paidBuyIn: 0 });
  const seat = table.seatOf(userId);

  const debit = await wallet.debitSpendable(userId, amount);
  if (!debit) {
    table.seats[seat] = null;
    throw new Error('Monedas insuficientes');
  }

  const player = table.seats[seat];
  // Composición del respaldo: las monedas pagadas primero, como en el cobro.
  player.paidStack = wallet.round2(debit.paidUsed);
  return player;
}

/**
 * Levanta a un usuario de la mesa y le devuelve sus fichas al monedero, cada
 * tipo a su cubo. Si se levanta a mitad de mano, primero se retira.
 */
async function standUp(hostId, userId) {
  const table = getTable(hostId);
  if (!table) throw new Error('No hay mesa abierta');
  const seat = table.seatOf(userId);
  if (seat === -1) throw new Error('No estás sentado en esta mesa');
  const player = table.seats[seat];

  // Reparto justo: lo que le queda de pila vuelve respaldado por pagadas hasta
  // donde llegue su `paidStack`, y el resto como regalo.
  const chips = wallet.round2(player.stack);
  const paid = wallet.round2(Math.min(chips, player.paidStack));
  const bonus = wallet.round2(chips - paid);

  table.standUp(userId);
  await wallet.creditSpendable(userId, { ttcC: paid, bonusC: bonus });
  return { chips, paid, bonus };
}

/**
 * Aplica la comisión de la casa tras terminar una mano. Suma lo recaudado al
 * acumulado de la mesa; se liquida al cerrar la sala.
 */
function accrueRake(hostId, rake) {
  const id = tableIdFor(hostId);
  const acc = rakeAccrual.get(id);
  if (!acc) return;
  acc.paid = wallet.round2(acc.paid + (rake?.paid || 0));
  acc.bonus = wallet.round2(acc.bonus + (rake?.bonus || 0));
  acc.hands += 1;
}

/**
 * Liquida la comisión acumulada: la paga al administrador. La parte de monedas
 * pagadas se abona como monedas pagadas (ingreso real) y la de regalo como
 * monedas de regalo, con su asiento en el libro para que quede auditable.
 *
 * Si no hay ningún administrador, la comisión no se pierde: se queda acumulada
 * en memoria hasta que haya uno.
 */
async function settleRake(hostId) {
  // La mesa de prácticas no recauda: no hay comisión que liquidar.
  if (isPractice(hostId)) return null;
  const id = tableIdFor(hostId);
  const acc = rakeAccrual.get(id);
  if (!acc || (acc.paid <= 0 && acc.bonus <= 0)) return null;

  const admin = await User.findOne({ role: 'admin' }).select('_id');
  if (!admin) return null;

  const paid = acc.paid;
  const bonus = acc.bonus;
  await wallet.creditSpendable(admin._id, { ttcC: paid, bonusC: bonus });

  const entries = [];
  if (paid > 0) {
    entries.push({
      from: admin._id,
      to: admin._id,
      amount: paid,
      type: 'poker_rake',
      ttcType: 'ttcC',
      method: 'poker',
      details: `Comisión POKERTAK de ${acc.hands} manos`,
    });
  }
  if (bonus > 0) {
    entries.push({
      from: admin._id,
      to: admin._id,
      amount: bonus,
      type: 'poker_rake_bonus',
      ttcType: 'ttcC',
      method: 'poker',
      details: `Comisión POKERTAK (regalo) de ${acc.hands} manos`,
    });
  }
  if (entries.length) await Transaction.create(entries);

  acc.paid = 0;
  acc.bonus = 0;
  acc.hands = 0;
  return { paid, bonus, adminId: String(admin._id) };
}

/**
 * Cierra la mesa: liquida la comisión, devuelve las fichas de todos los que
 * siguen sentados y borra la mesa. Es lo que pasa al cerrar la sala de juegos o
 * el directo.
 */
async function closeTable(hostId) {
  const table = getTable(hostId);
  if (!table) return { settled: null, refunded: [] };

  // La mesa de prácticas no devuelve nada al monedero: las fichas eran de
  // juguete. Se tira la mesa y listo.
  if (isPractice(hostId)) {
    cancelAutoDeal(hostId);
    tables.delete(tableIdFor(hostId));
    return { settled: null, refunded: [] };
  }

  const settled = await settleRake(hostId).catch(() => null);
  const refunded = [];
  for (const player of table.players()) {
    try {
      const result = await standUp(hostId, player.userId);
      refunded.push({ userId: player.userId, ...result });
    } catch {
      // Si uno falla no se bloquea a los demás; se sigue devolviendo el resto.
    }
  }
  cancelAutoDeal(hostId);
  tables.delete(tableIdFor(hostId));
  rakeAccrual.delete(tableIdFor(hostId));
  return { settled, refunded };
}

function stats(hostId) {
  const acc = rakeAccrual.get(tableIdFor(hostId));
  return acc ? { ...acc } : { paid: 0, bonus: 0, hands: 0 };
}

// Solo para las pruebas: deja el estado limpio entre casos.
function _reset() {
  for (const timer of autoDealTimers.values()) clearTimeout(timer);
  autoDealTimers.clear();
  tables.clear();
  rakeAccrual.clear();
}

module.exports = {
  getOrCreateTable,
  getTable,
  startHand,
  canAutoDeal,
  scheduleAutoDeal,
  cancelAutoDeal,
  AUTO_DEAL_WAIT_MS,
  AUTO_DEAL_AFTER_SHOWDOWN_MS,
  rakeRateFor,
  sitDown,
  standUp,
  accrueRake,
  settleRake,
  closeTable,
  stats,
  tableIdFor,
  // Mesa de prácticas (bots, sin monedero).
  PRACTICE_HOST,
  isPractice,
  isBotId,
  getOrCreatePracticeTable,
  sitDownPractice,
  standUpPractice,
  botToAct,
  playBotTurn,
  playBotTurns,
  practiceTable,
  _reset,
};
