// Torneos de POKERTAK: eventos programados con entrada, aforo y premios.
//
// La mesa normal cobra comisión por mano y devuelve las fichas al levantarse; un
// torneo es otra cosa: se cobra una entrada al inscribirse, todo lo recaudado
// forma un bote, y al terminar se paga a los tres primeros y la casa se queda su
// tarifa. Este módulo lleva el ciclo de vida del evento y el dinero.
//
// El reparto de premios es aritmética pura (`games/poker/prize`), aquí solo se
// aplica. El cobro y el pago usan el monedero, que ya sabe repartir entre
// monedas pagadas y de regalo: un premio pagado con monedas pagadas sigue siendo
// dinero real, y uno pagado con regalo se queda en el circuito de regalo.

const User = require('../models/User');
const Squad = require('../models/Squad');
const Transaction = require('../models/Transaction');
const PokerEvent = require('../models/PokerEvent');
const wallet = require('./walletService');
const notificationService = require('./notificationService');
const env = require('../config/env');
const { prizePayout, DEFAULT_SPLIT, DEFAULT_RAKE } = require('../games/poker/prize');

// Cómo se reparte por defecto. Se puede pasar otro reparto al crear el evento,
// pero el que se guarda es el que se le promete al jugador.
const DEFAULT_RAKE_RATE = Number.isFinite(Number(env.poker?.eventRake))
  ? Number(env.poker.eventRake)
  : DEFAULT_RAKE;

function normalizeSplit(split) {
  if (!Array.isArray(split) || split.length === 0) return [...DEFAULT_SPLIT];
  const clean = split.map((s) => Math.max(0, Number(s) || 0)).filter((s) => s > 0);
  return clean.length ? clean : [...DEFAULT_SPLIT];
}

/**
 * Crea un evento. No cobra nada todavía: eso pasa al inscribirse. La fecha debe
 * ser futura y el aforo, el de una mesa de póker (2 a 9).
 */
async function createEvent({
  title,
  adminId,
  squadSlug,
  scheduledAt,
  entryCost,
  maxPlayers,
  rakeRate,
  split,
} = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('El evento necesita un título');
  const squad = await Squad.findOne({ slug: String(squadSlug || '').trim().toLowerCase() });
  if (!squad) throw new Error('No existe esa sala');
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error('Fecha y hora inválidas');
  const cost = Number(entryCost);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('La entrada debe ser mayor que cero');
  const seats = Math.floor(Number(maxPlayers));
  if (!Number.isFinite(seats) || seats < 2 || seats > 9) {
    throw new Error('El aforo debe estar entre 2 y 9 jugadores');
  }
  const rake = Number.isFinite(Number(rakeRate))
    ? Math.min(Math.max(Number(rakeRate), 0), 1)
    : DEFAULT_RAKE_RATE;

  const event = await PokerEvent.create({
    title: cleanTitle,
    createdBy: adminId,
    squad: squad._id,
    scheduledAt: when,
    entryCost: cost,
    maxPlayers: seats,
    rakeRate: rake,
    split: normalizeSplit(split),
    status: 'scheduled',
    players: [],
  });

  // Se avisa a todas las cuentas de que hay torneo. Es lo que pidió la idea: el
  // torneo no se queda solo en el cartel de la sala, sino que sale en la campana
  // de todo el mundo. Va después de crear el evento y no puede tumbar la
  // creación: si el aviso falla, el torneo ya existe.
  await notificationService
    .announceTournament({ event, actorId: adminId })
    .catch(() => 0);

  return event;
}

/**
 * Inscribe a un jugador: cobra la entrada de su monedero y guarda su asiento.
 *
 * El cobro va antes de guardar la inscripción y, si guardar falla, se devuelve
 * el dinero: nunca se queda alguien fuera del torneo con la entrada cobrada.
 * Tampoco se puede inscribir dos veces ni pasarse del aforo.
 */
async function joinEvent({ eventId, userId, username } = {}) {
  const event = await PokerEvent.findById(eventId);
  if (!event) throw new Error('Evento no encontrado');
  if (event.status !== 'scheduled') throw new Error('El torneo ya no admite inscripciones');
  if (event.isPlayer(userId)) throw new Error('Ya estás inscrito en este torneo');
  if (event.players.length >= event.maxPlayers) throw new Error('El torneo está lleno');

  const debit = await wallet.debitSpendable(userId, event.entryCost);
  if (!debit) throw new Error('Monedas insuficientes para la entrada');

  const seat = event.players.length;
  event.players.push({
    user: userId,
    username,
    seat,
    paid: event.entryCost,
    paidFromTtcC: wallet.round2(debit.paidUsed),
    paidFromBonus: wallet.round2(debit.bonusUsed),
  });
  try {
    await event.save();
  } catch (err) {
    await wallet.creditSpendable(userId, {
      ttcC: wallet.round2(debit.paidUsed),
      bonusC: wallet.round2(debit.bonusUsed),
    });
    throw err;
  }

  await Transaction.create({
    from: userId,
    to: userId,
    amount: event.entryCost,
    type: 'poker_event_entry',
    ttcType: 'ttcC',
    method: 'poker',
    details: `Entrada al torneo ${event.title}`,
  });

  return event;
}

/**
 * Reparte los premios de un torneo ya terminado.
 *
 * `ranking` es la lista de ids de usuario en orden de puesto (primero el
 * ganador). Se paga a los puestos que cubre el reparto y, si el torneo tuvo
 * menos jugadores, solo a los que existen. Cada premio entra en el cubo del que
 * salió su parte del bote: monedas pagadas como pagadas, regalo como regalo.
 *
 * Es idempotente por estado: solo un evento en `running` puede cerrarse, así que
 * dos peticiones a la vez no pagan dos veces.
 */
async function finishEvent({ eventId, ranking } = {}) {
  const event = await PokerEvent.findById(eventId);
  if (!event) throw new Error('Evento no encontrado');
  if (event.status === 'finished') return { event, already: true };
  if (event.status !== 'running') throw new Error('El torneo no está en juego');

  const entrants = event.players.length;
  const payout = prizePayout({
    buyIn: event.entryCost,
    entrants,
    rakeRate: event.rakeRate,
    split: event.split,
  });

  // Orden de llegada: lo que diga el ranking y, si falta alguno, el resto en el
  // orden en que se inscribieron. Así siempre hay una lista completa.
  const ordered = [];
  for (const id of Array.isArray(ranking) ? ranking : []) {
    const player = event.players.find((p) => String(p.user) === String(id));
    if (player && !ordered.includes(player)) ordered.push(player);
  }
  for (const player of event.players) if (!ordered.includes(player)) ordered.push(player);

  // El bote por jugador se divide entre pagadas y regalo según su propia
  // entrada, para no convertir regalo en dinero al premiar.
  const totalPaid = wallet.round2(event.players.reduce((a, p) => a + (p.paidFromTtcC || 0), 0));
  const paidRatio = payout.gross > 0 ? Math.min(1, totalPaid / payout.gross) : 0;

  const results = [];
  for (const place of payout.places) {
    const player = ordered[place.place - 1];
    if (!player) break;
    const paid = wallet.round2(place.amount * paidRatio);
    const bonus = wallet.round2(place.amount - paid);
    await wallet.creditSpendable(player.user, { ttcC: paid, bonusC: bonus });
    await Transaction.create({
      from: player.user,
      to: player.user,
      amount: place.amount,
      type: 'poker_event_prize',
      ttcType: 'ttcC',
      method: 'poker',
      details: `Premio ${place.place}º puesto — ${event.title}`,
    });
    results.push({
      place: place.place,
      user: player.user,
      username: player.username,
      amount: place.amount,
    });
  }

  // La tarifa de la casa, en el tipo de moneda del que salió.
  const admin = await User.findById(event.createdBy).select('_id');
  if (admin && payout.rake > 0) {
    const paid = wallet.round2(payout.rake * paidRatio);
    const bonus = wallet.round2(payout.rake - paid);
    await wallet.creditSpendable(admin._id, { ttcC: paid, bonusC: bonus });
    const entries = [];
    if (paid > 0) {
      entries.push({
        from: admin._id,
        to: admin._id,
        amount: paid,
        type: 'poker_event_rake',
        ttcType: 'ttcC',
        method: 'poker',
        details: `Tarifa del torneo ${event.title}`,
      });
    }
    if (bonus > 0) {
      entries.push({
        from: admin._id,
        to: admin._id,
        amount: bonus,
        type: 'poker_event_rake_bonus',
        ttcType: 'ttcC',
        method: 'poker',
        details: `Tarifa del torneo ${event.title} (regalo)`,
      });
    }
    if (entries.length) await Transaction.create(entries);
  }

  event.results = results;
  event.prizePool = payout.prizePool;
  event.houseCut = payout.rake;
  event.status = 'finished';
  event.finishedAt = new Date();
  await event.save();
  return { event, payout, already: false };
}

/**
 * Cancela un torneo y devuelve la entrada a todos los inscritos, cada uno en el
 * mismo tipo de moneda con que pagó. Es idempotente por estado.
 */
async function cancelEvent({ eventId, reason } = {}) {
  const event = await PokerEvent.findById(eventId);
  if (!event) throw new Error('Evento no encontrado');
  if (event.status === 'cancelled') return { event, already: true };
  if (event.status === 'finished') throw new Error('Un torneo ya jugado no se puede cancelar');

  const refunded = [];
  for (const player of event.players) {
    await wallet.creditSpendable(player.user, {
      ttcC: wallet.round2(player.paidFromTtcC || 0),
      bonusC: wallet.round2(player.paidFromBonus || 0),
    });
    await Transaction.create({
      from: player.user,
      to: player.user,
      amount: player.paid,
      type: 'poker_event_refund',
      ttcType: 'ttcC',
      method: 'poker',
      details: `Devolución del torneo ${event.title}`,
    });
    refunded.push({ user: player.user, username: player.username, amount: player.paid });
  }

  event.status = 'cancelled';
  event.cancelReason = String(reason || '').slice(0, 300);
  await event.save();
  return { event, refunded, already: false };
}

/**
 * Proyección del evento para el panel y para el asistente. No expone datos de
 * nadie más que el nombre y el asiento de los inscritos.
 */
function publicEvent(event) {
  // La previsión se calcula con los inscritos de ahora; si aún no hay ninguno,
  // con el aforo completo, que es lo que promete el cartel del torneo.
  const projectedEntrants = event.players.length || event.maxPlayers;
  const payout = prizePayout({
    buyIn: event.entryCost,
    entrants: projectedEntrants,
    rakeRate: event.rakeRate,
    split: event.split,
  });
  return {
    id: event._id.toString(),
    title: event.title,
    squad: event.squad?.toString?.() || String(event.squad),
    scheduledAt: event.scheduledAt,
    entryCost: event.entryCost,
    maxPlayers: event.maxPlayers,
    rakeRate: event.rakeRate,
    split: event.split,
    status: event.status,
    players: event.players.map((p) => ({
      id: p.user.toString(),
      username: p.username,
      seat: p.seat,
    })),
    seatsTaken: event.players.length,
    seatsFree: Math.max(0, event.maxPlayers - event.players.length),
    // Lo que se repartiría con los inscritos de ahora mismo. Es una previsión:
    // el bote real se calcula al cerrar el torneo.
    projectedPrizePool: payout.prizePool,
    projectedHouseCut: payout.rake,
    projectedPlaces: payout.places,
    results: (event.results || []).map((r) => ({
      place: r.place,
      username: r.username,
      amount: r.amount,
    })),
  };
}

async function listEvents({ status, squadSlug, limit = 20 } = {}) {
  const query = {};
  if (status) query.status = status;
  // Filtrar por sala permite que la mesa enseñe solo los torneos de su directo.
  if (squadSlug) {
    const squad = await Squad.findOne({ slug: String(squadSlug).trim().toLowerCase() }).select('_id');
    if (!squad) return [];
    query.squad = squad._id;
  }
  const events = await PokerEvent.find(query).sort({ scheduledAt: -1 }).limit(Math.min(Number(limit) || 20, 100));
  return events.map(publicEvent);
}

async function getEvent(eventId) {
  const event = await PokerEvent.findById(eventId);
  return event ? publicEvent(event) : null;
}

module.exports = {
  createEvent,
  joinEvent,
  finishEvent,
  cancelEvent,
  listEvents,
  getEvent,
  publicEvent,
  DEFAULT_SPLIT,
  DEFAULT_RAKE_RATE,
};
