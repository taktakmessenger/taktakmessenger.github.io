// Estrategia de los bots de la mesa de prácticas.
//
// Un bot no es un jugador listo: es alguien con quien aprender sin miedo. Por
// eso juega de forma reconocible (mira su mano, respeta las probabilidades del
// bote y sube cuando tiene algo bueno) en vez de calcular el óptimo. Se decide
// con la fuerza de la mano y un poco de azar, para que dos manos iguales no se
// jueguen siempre del mismo modo y la mesa no resulte predecible.

const { bestHand } = require('./handEvaluator');

// Fuerza de la mano, de 0 (basura) a 1 (casi imbatible). Preflop se mira solo
// la pareja de cartas propias, que es lo único que hay; de ahí en adelante, la
// categoría de la mejor jugada posible con la mesa.
function handStrength(table, player) {
  if (table.board.length === 0) {
    const [a, b] = player.holeCards;
    if (!a || !b) return 0;
    const hi = Math.max(a.rank, b.rank);
    const lo = Math.min(a.rank, b.rank);
    let s = (hi + lo) / 28;
    if (a.rank === b.rank) s += 0.35;
    if (a.suit === b.suit) s += 0.08;
    if (hi === 14) s += 0.05;
    return Math.min(1, s);
  }
  const { category } = bestHand(player.holeCards, table.board);
  return Math.min(1, category / 8);
}

// Subida legal: el mayor objetivo entre el mínimo permitido y lo que le queda,
// redondeado a la ciega grande para que las apuestas se lean como en una mesa
// real. `fraction` es la parte del bote que se quiere poner por encima.
function raiseTarget(table, player, fraction) {
  const isRaise = table.currentBet > 0;
  const minTarget = isRaise ? table.currentBet + table.minRaise : table.bigBlind;
  const maxTarget = player.bet + player.stack;
  if (maxTarget <= minTarget) return maxTarget;
  const step = Math.max(1, table.bigBlind);
  const raw = table.currentBet + table.pot * fraction + table.bigBlind;
  const rounded = Math.round(raw / step) * step;
  return Math.max(minTarget, Math.min(maxTarget, rounded));
}

/**
 * Decide la acción de un bot en su turno. Devuelve `{ action, amount }`, listo
 * para `table.act`. El azar solo desempata entre opciones parecidas: nunca
 * convierte una mano fuerte en un retirada absurda.
 */
function decideBotAction(table, seat) {
  const player = table.seats[seat];
  if (!player) return { action: 'fold' };
  const toCall = Math.max(0, table.currentBet - player.bet);
  const strength = handStrength(table, player);
  const r = Math.random();

  // Nadie ha apostado: pasar o apostar.
  if (toCall === 0) {
    if (strength > 0.62 && r < 0.75) {
      return { action: 'raise', amount: raiseTarget(table, player, 0.6) };
    }
    if (strength > 0.42 && r < 0.35) {
      return { action: 'raise', amount: raiseTarget(table, player, 0.35) };
    }
    return { action: 'check' };
  }

  // Hay algo que igualar: se compara la fuerza con lo que cuesta igualar.
  const potOdds = table.pot > 0 ? toCall / (table.pot + toCall) : 1;
  if (strength > 0.78 && r < 0.65) {
    return { action: 'raise', amount: raiseTarget(table, player, 0.8) };
  }
  if (strength >= potOdds + 0.12) return { action: 'call' };
  // Un órdago de vez en cuando, para que igualar no sea siempre lo correcto.
  if (strength > 0.3 && r < 0.12) return { action: 'call' };
  return { action: 'fold' };
}

module.exports = { decideBotAction, handStrength, raiseTarget };
