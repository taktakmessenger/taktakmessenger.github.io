const test = require('node:test');
const assert = require('node:assert/strict');
const { PokerTable } = require('../src/games/poker/pokerTable');

// Baraja fija para las pruebas: se le da la lista de cartas en el orden exacto en
// que se van a sacar, así una mano entera es reproducible. `draw()` devuelve la
// siguiente y `burn()` la salta (como el descarte antes del flop).
function fixedDeck(cards) {
  let i = 0;
  return () => ({
    remaining: () => cards.length - i,
    draw: () => cards[i++],
    burn: () => { i += 1; },
  });
}

// Carta desde 'As' (as de picas). Mismo formato que en el evaluador.
const RANKS = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
function card(str) {
  const rank = RANKS[str[0]] || Number(str[0]);
  return { rank, suit: str[1] };
}

// Reparto de una mano concreta. `hole` va indexado por asiento y `order` es el
// orden real en que el motor reparte (empieza por la ciega pequeña). Se dan dos
// rondas, luego descarte+flop, descarte+turn y descarte+river.
function deal({ hole, order, board }) {
  const cards = [];
  for (let round = 0; round < 2; round += 1) {
    for (const seat of order) cards.push(card(hole[seat][round]));
  }
  cards.push(card('2c')); // descarte
  cards.push(card(board[0]), card(board[1]), card(board[2]));
  cards.push(card('2d')); // descarte
  cards.push(card(board[3]));
  cards.push(card('2h')); // descarte
  cards.push(card(board[4]));
  return fixedDeck(cards);
}

function tableWith(players, opts = {}) {
  const { paidBuyIn, ...tableOpts } = opts;
  const table = new PokerTable({ maxSeats: 6, smallBlind: 5, bigBlind: 10, minBuyIn: 100, ...tableOpts });
  players.forEach((p) => table.sitDown(p.id, p.name, p.stack, { paidBuyIn: paidBuyIn ?? p.stack }));
  return table;
}

test('sentarse exige la entrada mínima y respeta el aforo', () => {
  const table = new PokerTable({ maxSeats: 2, minBuyIn: 100, maxBuyIn: 1000 });
  assert.throws(() => table.sitDown('u1', 'Ana', 50), /entrada mínima/i);
  table.sitDown('u1', 'Ana', 100);
  table.sitDown('u2', 'Luis', 100);
  assert.throws(() => table.sitDown('u3', 'Eva', 100), /llena/i);
  assert.throws(() => table.sitDown('u1', 'Ana', 100), /ya estás sentado/i);
});

test('la mano reparte ciegas, dos cartas a cada uno y pone el turno tras la ciega grande', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    { deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']], board: ['2s', '3s', '4s', '5s', '6s'] }) }
  );
  const state = table.startHand();
  assert.equal(state.phase, 'preflop');
  assert.equal(state.pot, 15, 'ciega pequeña 5 + grande 10');
  // El botón es el asiento 0 (Ana); con tres jugadores la ciega pequeña es Luis
  // (asiento 1) y la grande Eva (asiento 2); habla Ana.
  assert.equal(state.buttonSeat, 0);
  assert.equal(state.turnSeat, 0);
  const totalHole = table.players().reduce((n, p) => n + p.holeCards.length, 0);
  assert.equal(totalHole, 6);
});

test('las cartas de los demás no se filtran hasta el showdown', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }],
    { deckFactory: deal({ order: [0, 1], hole: [['As', 'Ah'], ['Ks', 'Kh']], board: ['2s', '3s', '4s', '5s', '6s'] }) }
  );
  table.startHand();
  const view = table.publicState('a');
  const self = view.seats.find((s) => s.userId === 'a');
  const other = view.seats.find((s) => s.userId === 'b');
  assert.deepEqual(self.holeCards, ['As', 'Ah']);
  assert.deepEqual(other.holeCards, [null, null], 'las del rival van ocultas');
  assert.equal(other.holeCount, 2);
});

test('no se puede actuar fuera de turno ni pasar habiendo apuesta', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    { deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']], board: ['2s', '3s', '4s', '5s', '6s'] }) }
  );
  table.startHand();
  // Habla Ana (asiento 0).
  assert.throws(() => table.act('b', 'check'), /no es tu turno/i);
  assert.throws(() => table.act('a', 'check'), /por igualar/i);
  // La subida mínima es a 20 (apuesta actual 10 + incremento 10); a 15 falla.
  assert.throws(() => table.act('a', 'raise', 15), /subida mínima/i);
  table.act('a', 'raise', 20);
  assert.equal(table.currentBet, 20);
});

test('una mano completa hasta el showdown paga al que tiene la mejor jugada', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }],
    { deckFactory: deal({ order: [0, 1], hole: [['As', 'Ah'], ['Ks', 'Kh']], board: ['2s', '7d', '9c', 'Jh', '3d'] }) }
  );
  table.startHand();
  // Heads-up: el botón (Ana, asiento 0) pone la ciega pequeña y habla primero.
  assert.equal(table.buttonSeat, 0);
  table.act('a', 'call'); // iguala 10
  table.act('b', 'check'); // la ciega grande pasa
  assert.equal(table.phase, 'flop');
  table.act('b', 'check');
  table.act('a', 'check');
  assert.equal(table.phase, 'turn');
  table.act('b', 'check');
  table.act('a', 'check');
  assert.equal(table.phase, 'river');
  table.act('b', 'check');
  table.act('a', 'check');
  assert.equal(table.phase, 'showdown');
  assert.equal(table.board.length, 5);
  // Ana tiene la pareja de ases; gana todo el bote (20).
  assert.equal(table.winners.length, 1);
  assert.equal(table.winners[0].username, 'Ana');
  assert.equal(table.winners[0].amount, 20);
  assert.equal(table.seats[0].stack, 1010);
  assert.equal(table.seats[1].stack, 990);
});

test('si todos se retiran menos uno, gana el bote sin enseñar cartas', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    { deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']], board: ['2s', '3s', '4s', '5s', '6s'] }) }
  );
  table.startHand();
  table.act('a', 'fold'); // Ana
  table.act('b', 'fold'); // Luis (ciega pequeña)
  // Eva (ciega grande) gana 15 sin showdown.
  assert.equal(table.phase, 'showdown');
  assert.equal(table.winners[0].username, 'Eva');
  assert.equal(table.winners[0].amount, 15);
});

test('el all-in corto solo puede ganar el bote que cubrió (bote lateral)', () => {
  // Ana va all-in con 100 y los otros dos la cubren y pasan hasta el final: no
  // hay bote lateral porque los tres pusieron lo mismo.
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 100 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    { deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']], board: ['2s', '7d', '9c', 'Jh', '3d'] }) }
  );
  table.startHand();
  table.act('a', 'all-in'); // 100
  table.act('b', 'call');
  table.act('c', 'call');
  // Luis y Eva siguen con fichas: pasan hasta el final.
  table.act('b', 'check'); table.act('c', 'check'); // flop
  table.act('b', 'check'); table.act('c', 'check'); // turn
  table.act('b', 'check'); table.act('c', 'check'); // river
  assert.equal(table.phase, 'showdown');
  assert.equal(table.pot, 300);
  // Ana gana con la pareja de ases: el bote entero, 300.
  assert.equal(table.winners.length, 1);
  assert.equal(table.winners[0].username, 'Ana');
  assert.equal(table.winners[0].amount, 300);
});

test('un bote lateral se lo lleva quien puso de más si su mano es mejor', () => {
  // Ana all-in corto con la mejor mano; Luis y Eva siguen apostando aparte. El
  // bote principal (150) es para Ana; el lateral (300) lo gana Eva con reyes.
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 50 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    {
      minBuyIn: 10,
      deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['2d', '2c'], ['Ks', 'Kh']], board: ['Qs', '7d', '9c', 'Jh', '3d'] }),
    }
  );
  table.startHand();
  table.act('a', 'all-in'); // 50
  table.act('b', 'raise', 200);
  table.act('c', 'call');
  // Luis y Eva pasan hasta el final.
  table.act('b', 'check'); table.act('c', 'check'); // flop
  table.act('b', 'check'); table.act('c', 'check'); // turn
  table.act('b', 'check'); table.act('c', 'check'); // river
  assert.equal(table.phase, 'showdown');
  const ana = table.winners.find((w) => w.username === 'Ana');
  const eva = table.winners.find((w) => w.username === 'Eva');
  assert.equal(ana.amount, 150, 'bote principal para Ana');
  assert.equal(eva.amount, 300, 'bote lateral para Eva');
  assert.equal(table.seats[1].won, 0, 'Luis no gana nada');
});

test('el bote se reparte a medias cuando dos manos empatan', () => {
  // Misma mano en la mesa para los dos: la mesa manda.
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }],
    { deckFactory: deal({ order: [0, 1], hole: [['As', 'Kh'], ['Ad', 'Kc']], board: ['Qs', 'Jd', 'Th', '2c', '3d'] }) }
  );
  table.startHand();
  table.act('a', 'call');
  table.act('b', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  assert.equal(table.phase, 'showdown');
  assert.equal(table.winners.length, 2);
  assert.equal(table.winners[0].amount + table.winners[1].amount, 20);
  assert.equal(table.seats[0].stack, 1000);
  assert.equal(table.seats[1].stack, 1000);
});

test('subir obliga a los demás a volver a hablar', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    { deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']], board: ['2s', '3s', '4s', '5s', '6s'] }) }
  );
  table.startHand();
  table.act('a', 'raise', 40); // Ana sube a 40
  table.act('b', 'call'); // Luis iguala
  // Eva (ciega grande) todavía no ha hablado; le toca a ella.
  assert.equal(table.turnSeat, 2);
  table.act('c', 'raise', 100); // Eva resube
  // Ana y Luis vuelven a tener que hablar.
  assert.equal(table.seats[0].acted, false);
  assert.equal(table.seats[1].acted, false);
});

test('la comisión de la casa se queda de cada bote (1% por mano)', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }],
    {
      rakeRate: 0.01,
      deckFactory: deal({ order: [0, 1], hole: [['As', 'Ah'], ['Ks', 'Kh']], board: ['2s', '7d', '9c', 'Jh', '3d'] }),
    }
  );
  table.startHand();
  table.act('a', 'call');
  table.act('b', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  assert.equal(table.phase, 'showdown');
  // Bote de 20; 1% = 0,2 para la casa; el ganador se lleva 19,8.
  assert.equal(table.rake.paid, 0.2);
  assert.equal(table.rake.bonus, 0);
  assert.equal(table.winners[0].amount, 19.8);
  // Ana puso 10 y se lleva 19,8: acaba con 1009,8.
  assert.equal(table.seats[0].stack, 1009.8);
  assert.equal(table.seats[1].stack, 990);
});

test('sin monedas pagadas en juego la comisión es de monedas de regalo', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }],
    {
      rakeRate: 0.1,
      // Ninguno tiene respaldo pagado: todo es moneda de regalo.
      paidBuyIn: 0,
      deckFactory: deal({ order: [0, 1], hole: [['As', 'Ah'], ['Ks', 'Kh']], board: ['2s', '7d', '9c', 'Jh', '3d'] }),
    }
  );
  table.startHand();
  table.act('a', 'call');
  table.act('b', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  table.act('b', 'check'); table.act('a', 'check');
  // Bote 20; 10% = 2, toda de regalo.
  assert.equal(table.rake.paid, 0);
  assert.equal(table.rake.bonus, 2);
  assert.equal(table.winners[0].amount, 18);
});

test('la comisión sin showdown también se cobra', () => {
  const table = tableWith(
    [{ id: 'a', name: 'Ana', stack: 1000 }, { id: 'b', name: 'Luis', stack: 1000 }, { id: 'c', name: 'Eva', stack: 1000 }],
    {
      rakeRate: 0.1,
      deckFactory: deal({ order: [1, 2, 0], hole: [['As', 'Ah'], ['Ks', 'Kh'], ['Qs', 'Qh']], board: ['2s', '3s', '4s', '5s', '6s'] }),
    }
  );
  table.startHand();
  table.act('a', 'fold');
  table.act('b', 'fold');
  // Eva gana 15; con 10% de comisión se lleva 13,5.
  assert.equal(table.winners[0].username, 'Eva');
  assert.equal(table.winners[0].amount, 13.5);
  assert.equal(table.rake.paid, 1.5, 'las monedas pagadas pagan la comisión de la casa');
});
