// Evaluador de manos de Texas Hold'em.
//
// Recibe las dos cartas del jugador y las cinco de la mesa y devuelve la mejor
// jugada de cinco cartas que se puede formar, con una puntuación que ordena
// unas manos por encima de otras. Es la parte del juego que decide quién gana el
// bote, así que está aislada y sin dependencias para poder probarla a fondo.
//
// Una carta es `{ rank, suit }` con `rank` de 2 a 14 (14 = as) y `suit` en
// 's' (picas), 'h' (corazones), 'd' (diamantes), 'c' (tréboles).

const RANK_LABELS = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

// Nombre de cada categoría, de peor a mejor. El índice es el valor de la
// categoría que devuelve el evaluador.
const CATEGORY_LABELS = [
  'carta alta',
  'pareja',
  'doble pareja',
  'trío',
  'escalera',
  'color',
  'full',
  'póker',
  'escalera de color',
];

const SUITS = ['s', 'h', 'd', 'c'];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) deck.push({ rank, suit });
  }
  return deck;
}

// Baraja Fisher-Yates. Recibe el generador para poder sembrarlo en las pruebas y
// obtener un reparto reproducible.
function shuffle(deck, rng = Math.random) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function cardLabel(card) {
  return `${RANK_LABELS[card.rank]}${card.suit}`;
}

// Reparte una baraja entera. Devuelve también `draw()`, que va sacando cartas
// de arriba sin repetir, para que el motor no tenga que gestionar índices.
function createDeck(rng = Math.random) {
  const cards = shuffle(makeDeck(), rng);
  let next = 0;
  return {
    remaining: () => cards.length - next,
    draw: () => cards[next++],
    burn: () => { next += 1; },
  };
}

// Cuenta cuántas cartas hay de cada rango, en un mapa rank -> veces.
function countByRank(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  return counts;
}

// Convierte un mapa de cuentas en la lista de rangos ordenada por (veces, rango)
// de mayor a menor. Es el orden que desempata dos manos de la misma categoría.
function ranksByCount(counts) {
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))
    .map(([rank]) => rank);
}

// Busca la escalera más alta en un conjunto de rangos. Devuelve el rango más
// alto de la escalera, o null. El as cuenta como 1 en la escalera A-2-3-4-5, que
// es la única en la que el as vale bajo.
function straightHigh(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  // Escalera con as bajo: A-5-4-3-2.
  if (unique.includes(14)) unique.push(1);

  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] === unique[i - 1] - 1) {
      run += 1;
      // Los rangos vienen de mayor a menor, así que la carta alta de la
      // escalera es la primera de la racha: unique[i - 4].
      if (run >= 5) return unique[i - 4];
    } else {
      run = 1;
    }
  }
  return null;
}

// Puntúa cinco cartas exactas. Devuelve [categoría, desempates...] para poder
// comparar dos jugadas con una comparación de arrays.
function scoreFive(cards) {
  const counts = countByRank(cards);
  const byCount = ranksByCount(counts);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh(cards.map((c) => c.rank));

  if (flush && high) return [8, high];

  const maxCount = Math.max(...counts.values());
  if (maxCount === 4) {
    const four = byCount[0];
    const kicker = byCount[1];
    return [7, four, kicker];
  }
  if (maxCount === 3 && byCount.length === 2) {
    // Con cinco cartas, un trío y otra carta solo puede ser full si la otra
    // carta también se repite (byCount.length === 2).
    return [6, byCount[0], byCount[1]];
  }
  if (flush) return [5, ...cards.map((c) => c.rank).sort((a, b) => b - a)];
  if (high) return [4, high];
  if (maxCount === 3) return [3, ...byCount];
  if (maxCount === 2 && byCount.length === 3) return [2, ...byCount];
  if (maxCount === 2) return [1, ...byCount];
  return [0, ...byCount];
}

// Compara dos puntuaciones. Positivo si `a` gana, negativo si pierde, 0 empate.
function compareScores(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Todas las combinaciones de `k` cartas de `cards`.
function combinations(cards, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < cards.length; i += 1) {
      acc.push(cards[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

/**
 * Mejor mano de cinco cartas entre las siete disponibles (dos propias más cinco
 * de la mesa). Prueba las 21 combinaciones posibles: es el reparto exacto que
 * hace un jugador al leer su mano, sin atajos que puedan equivocarse.
 */
function bestHand(hole = [], board = []) {
  const all = [...hole, ...board];
  if (all.length < 5) {
    // Mano incompleta (preflop): se puntúa como carta alta para no romper la
    // comparación mientras la mesa aún no tiene cartas.
    return { category: 0, label: CATEGORY_LABELS[0], score: [0, ...all.map((c) => c.rank).sort((a, b) => b - a)] };
  }
  let best = null;
  for (const combo of combinations(all, 5)) {
    const score = scoreFive(combo);
    if (!best || compareScores(score, best.score) > 0) best = { score, cards: combo };
  }
  return {
    category: best.score[0],
    label: CATEGORY_LABELS[best.score[0]],
    score: best.score,
    cards: best.cards,
  };
}

module.exports = {
  SUITS,
  RANK_LABELS,
  CATEGORY_LABELS,
  makeDeck,
  shuffle,
  createDeck,
  cardLabel,
  bestHand,
  compareScores,
  straightHigh,
  scoreFive,
};
