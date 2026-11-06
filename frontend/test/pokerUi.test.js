import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitSeats,
  seatLayout,
  seatScale,
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

  const nine = seatLayout(9);
  assert.equal(nine.length, 9);
  for (const p of nine) {
    assert.ok(p.x >= 0 && p.x <= 100);
    assert.ok(p.y >= 0 && p.y <= 100);
  }
});

test('el número de asientos se limita a nueve', () => {
  assert.equal(seatLayout(0).length, 1);
  assert.equal(seatLayout(99).length, 9);
});

test('el tamaño del asiento se ajusta a los que se sientan sin salirse ni pisarse', () => {
  const base = { w: 68, h: 157 };
  const felt = { w: 400, h: 577 };
  const overlaps = (a, b) => !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);
  const check = (seats) => {
    const { scale } = fitSeats(seats, base, felt, 0.62);
    const ring = seatLayout(seats.length || 1);
    const bs = ring.map((p) => {
      const w = base.w * scale;
      const h = base.h * scale;
      const cx = (p.x / 100) * felt.w;
      const cy = (p.y / 100) * felt.h;
      return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
    });
    for (let i = 0; i < bs.length; i += 1) {
      assert.ok(bs[i].l >= 1.5 && bs[i].r <= felt.w - 1.5, 'no se sale por los lados');
      assert.ok(bs[i].t >= 1.5 && bs[i].b <= felt.h - 1.5, 'no se sale por arriba ni abajo');
      for (let j = i + 1; j < bs.length; j += 1) assert.ok(!overlaps(bs[i], bs[j]), 'no se pisan');
    }
    return scale;
  };
  // Pocos jugadores: el recuadro se ve grande. Muchos: se encoge para que quepan.
  const two = check([0, 1]);
  const nine = check([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(two > nine, 'con dos el asiento es más grande que con nueve');
  assert.ok(nine > 0.5, 'con nueve el asiento sigue siendo legible');
  // Los huecos solo se enseñan donde no pisan a nadie.
  const { emptySeats } = fitSeats([0, 1], base, felt, 0.62);
  assert.ok(emptySeats.every((seat) => seat >= 2), 'no se enseña un hueco en una plaza ocupada');
});

test('el recuadro del asiento encoge según cuántos se sientan', () => {
  assert.ok(seatScale(2) > seatScale(5));
  assert.ok(seatScale(5) > seatScale(9));
  assert.equal(seatScale(0), 1.1);
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
