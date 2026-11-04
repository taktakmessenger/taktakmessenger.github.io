import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seatLayout,
  formatCoins,
  legalActions,
  ownSeat,
  phaseLabel,
  actionLabel,
} from '../src/lib/pokerUi.js';

// Los helpers de la mesa de POKERTAK son funciones puras: se prueba la lógica de
// verdad (asientos, acciones legales, formato) sin navegador.

test('los asientos se reparten alrededor de la mesa y el 0 va abajo', () => {
  const two = seatLayout(2);
  assert.equal(two.length, 2);
  // El asiento 0 abajo (y grande) y el 1 arriba.
  assert.ok(two[0].y > 50);
  assert.ok(two[1].y < 50);

  const six = seatLayout(6);
  assert.equal(six.length, 6);
  for (const p of six) {
    assert.ok(p.x >= 0 && p.x <= 100);
    assert.ok(p.y >= 0 && p.y <= 100);
  }
});

test('el número de asientos se limita a seis', () => {
  assert.equal(seatLayout(0).length, 1);
  assert.equal(seatLayout(99).length, 6);
});

test('las monedas se formatean con separador de miles', () => {
  assert.equal(formatCoins(1250), '1.250');
  assert.equal(formatCoins(19.8), '19,8');
  assert.equal(formatCoins(0), '0');
  assert.equal(formatCoins('x'), '0');
});

test('las acciones legales dependen del turno y de la apuesta', () => {
  const state = {
    phase: 'preflop',
    turnSeat: 1,
    currentBet: 10,
    minRaise: 10,
    bigBlind: 10,
    seats: [
      { seat: 0, userId: 'a', bet: 0, stack: 1000, folded: false, allIn: false },
      { seat: 1, userId: 'b', bet: 10, stack: 990, folded: false, allIn: false },
    ],
  };
  // No es el turno del asiento 0.
  assert.equal(legalActions(state, 0).yourTurn, false);
  // El asiento 1 ya igualó la ciega: puede pasar, no igualar.
  const b = legalActions(state, 1);
  assert.equal(b.yourTurn, true);
  assert.equal(b.canCheck, true);
  assert.equal(b.canCall, false);
  assert.equal(b.minRaiseTo, 20);
  assert.equal(b.maxRaiseTo, 1000);
});

test('un jugador retirado o all-in no puede actuar', () => {
  const state = {
    phase: 'flop', turnSeat: 0, currentBet: 0, bigBlind: 10,
    seats: [{ seat: 0, userId: 'a', folded: true, allIn: false, stack: 100, bet: 0 }],
  };
  assert.equal(legalActions(state, 0).yourTurn, false);
});

test('en showdown no hay acciones', () => {
  const state = {
    phase: 'showdown', turnSeat: null, currentBet: 0, bigBlind: 10,
    seats: [{ seat: 0, userId: 'a', folded: false, allIn: false, stack: 100, bet: 0 }],
  };
  assert.equal(legalActions(state, 0).yourTurn, false);
});

test('ownSeat encuentra el asiento del jugador', () => {
  const state = { seats: [{ empty: true }, { seat: 1, userId: 'b' }] };
  assert.equal(ownSeat(state, 'b'), 1);
  assert.equal(ownSeat(state, 'z'), -1);
});

test('la fase y la acción tienen rótulo en castellano', () => {
  assert.equal(phaseLabel('preflop'), 'Pre-flop');
  assert.equal(phaseLabel('showdown'), 'Showdown');
  assert.equal(actionLabel('raise', 60), 'Sube a 60');
  assert.equal(actionLabel('fold'), 'Se retira');
});
