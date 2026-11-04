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
const wallet = require('./walletService');

// Mesas abiertas: `tableId -> PokerTable`. El id es el del anfitrión.
const tables = new Map();

// Cuánto se ha recaudado en cada mesa y quién debe recibirlo. La comisión no se
// paga mano a mano (serían cientos de micro-transacciones): se acumula y se
// liquida al cerrar la sala.
const rakeAccrual = new Map(); // tableId -> { paid, bonus, hands }

function tableIdFor(hostId) {
  return `poker:${hostId}`;
}

function getOrCreateTable(hostId) {
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
  table.rakeRate = rakeRateFor();
  return table.startHand();
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
  tables.clear();
  rakeAccrual.clear();
}

module.exports = {
  getOrCreateTable,
  getTable,
  startHand,
  rakeRateFor,
  sitDown,
  standUp,
  accrueRake,
  settleRake,
  closeTable,
  stats,
  tableIdFor,
  _reset,
};
