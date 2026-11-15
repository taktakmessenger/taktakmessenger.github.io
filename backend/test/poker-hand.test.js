const test = require('node:test');
const assert = require('node:assert/strict');
const {
  makeDeck,
  createDeck,
  bestHand,
  compareScores,
  straightHigh,
  scoreFive,
  cardLabel,
} = require('../src/games/poker/handEvaluator');

// Atajo: construye cartas desde una cadena como 'As Kh 5d' (rank en letra).
const RANKS = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
function c(str) {
  return str.split(' ').map((token) => {
    const rankChar = token[0];
    const rank = RANKS[rankChar] || Number(rankChar);
    return { rank, suit: token[1] };
  });
}
// Las siete cartas van en una sola cadena separada por espacios.
const hand = (cards) => bestHand(c(cards));

test('la baraja tiene 52 cartas y no se repite ninguna', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 52);
  const labels = new Set(deck.map(cardLabel));
  assert.equal(labels.size, 52);
});

test('el reparto saca 52 cartas distintas y luego se agota', () => {
  let seed = 1;
  const rng = () => {
    // Generador determinista simple para que el reparto sea reproducible.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const deck = createDeck(rng);
  const drawn = [];
  while (deck.remaining() > 0) drawn.push(cardLabel(deck.draw()));
  assert.equal(drawn.length, 52);
  assert.equal(new Set(drawn).size, 52);
});

test('reconoce cada categoría de mano', () => {
  assert.equal(hand('As Ah Ad Ac Kh').category, 7, 'póker');
  assert.equal(hand('As Ah Ad Kc Kh').category, 6, 'full');
  assert.equal(hand('As Ks Qs Js 9s').category, 5, 'color');
  assert.equal(hand('Ts 9d 8c 7h 6s').category, 4, 'escalera');
  assert.equal(hand('As Ah Ad 9c 2h').category, 3, 'trío');
  assert.equal(hand('As Ah Kd Kc 2h').category, 2, 'doble pareja');
  assert.equal(hand('As Ah Kd Qc 2h').category, 1, 'pareja');
  assert.equal(hand('As Kd Qc Jh 9s').category, 0, 'carta alta');
  assert.equal(hand('As Ks Qs Js Ts').category, 8, 'escalera de color');
});

test('la escalera con as bajo (A-2-3-4-5) vale, y el as no cierra A-K-Q-J-9', () => {
  assert.equal(straightHigh([14, 2, 3, 4, 5]), 5);
  assert.equal(straightHigh([14, 13, 12, 11, 9]), null);
  assert.equal(hand('As 2d 3c 4h 5s').category, 4);
});

test('entre siete cartas se elige la mejor jugada, no las cinco primeras', () => {
  // Con el board sale una escalera aunque la mano suelta no la tenga.
  const best = bestHand(c('2c 7d'), c('As Kd Qc Jh Ts'));
  assert.equal(best.category, 4);
  assert.equal(best.score[1], 14, 'escalera al as');
});

test('el póker gana al full y el color a la escalera', () => {
  assert.ok(compareScores(hand('As Ah Ad Ac 2h').score, hand('Ks Kh Kd Qc Qh').score) > 0);
  assert.ok(compareScores(hand('As Ks Qs Js 9s').score, hand('Ts 9d 8c 7h 6s').score) > 0);
});

test('la pareja de ases gana a la pareja de reyes por la carta alta', () => {
  assert.ok(compareScores(hand('As Ah Kd Qc 9h').score, hand('Ks Kh Ad Qc 9h').score) > 0);
});

test('dos manos idénticas en cartas distintas empatan', () => {
  const a = hand('As Ah Kd Qc 9h');
  const b = hand('Ac Ad Ks Qh 9s');
  assert.equal(compareScores(a.score, b.score), 0);
});

test('el color se desempata por la carta alta y luego por la siguiente', () => {
  assert.ok(compareScores(hand('As Ks Qs Js 9s').score, hand('As Ks Qs Js 8s').score) > 0);
  assert.ok(compareScores(hand('As Ks Qs 8s 7s').score, hand('Ah Kh Qh 9h 2h').score) < 0);
});

test('el full se compara por el trío antes que por la pareja', () => {
  assert.ok(compareScores(hand('Ks Kh Kd 2c 2h').score, hand('Qs Qh Qd Ac Ah').score) > 0);
});

test('la escalera de color al as gana al póker', () => {
  assert.ok(compareScores(hand('As Ks Qs Js Ts').score, hand('Ah Ad Ac As Kh').score) > 0);
});
