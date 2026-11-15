const test = require('node:test');
const assert = require('node:assert/strict');
const { prizePayout, DEFAULT_SPLIT, DEFAULT_RAKE } = require('../src/games/poker/prize');

// El reparto de premios es aritmética pura: no toca base de datos ni monedero,
// así que se comprueba con números. Lo importante es que nunca se reparta de más
// y que el reparto por defecto (40/30/20 + 10% de tarifa) cuadre al céntimo.

test('reparte 40/30/20 del bruto y la casa se queda el 10% con 9 jugadores', () => {
  const p = prizePayout({ buyIn: 100, entrants: 9, rakeRate: 0.1, split: DEFAULT_SPLIT });

  assert.equal(p.gross, 900, '9 x 100 de recaudación');
  assert.equal(p.rake, 90, 'la casa se lleva el 10% del bruto');
  assert.equal(p.prizePool, 810, 'el bote de premios es el 90%');
  assert.equal(p.places.length, 3);
  // 40% / 30% / 20% del bruto de 900.
  assert.deepEqual(
    p.places.map((x) => x.amount),
    [360, 270, 180]
  );
  assert.equal(
    p.places.reduce((a, x) => a + x.amount, 0),
    p.prizePool,
    'los premios suman el bote al céntimo'
  );
});

test('con menos jugadores que puestos solo se paga a los que existen', () => {
  const p = prizePayout({ buyIn: 100, entrants: 2, rakeRate: 0.1, split: DEFAULT_SPLIT });

  assert.equal(p.gross, 200);
  assert.equal(p.prizePool, 180, '200 menos el 10% de tarifa');
  assert.equal(p.places.length, 2, 'con dos jugadores no hay tercer puesto');
  // El reparto se reajusta: 40/30 sobre 70 pasa a 57.14/42.86 del bote.
  assert.equal(p.places[0].amount + p.places[1].amount, p.prizePool);
  assert.ok(p.places[0].amount > p.places[1].amount, 'el primero cobra más que el segundo');
});

test('sin jugadores no hay premios ni tarifa', () => {
  const p = prizePayout({ buyIn: 100, entrants: 0, rakeRate: 0.1 });
  assert.equal(p.gross, 0);
  assert.equal(p.rake, 0);
  assert.equal(p.prizePool, 0);
  assert.deepEqual(p.places, []);
});

test('con tarifa cero se reparte todo lo recaudado', () => {
  const p = prizePayout({ buyIn: 50, entrants: 9, rakeRate: 0, split: DEFAULT_SPLIT });
  assert.equal(p.rake, 0);
  assert.equal(p.prizePool, p.gross);
  assert.equal(p.places.reduce((a, x) => a + x.amount, 0), p.gross);
});

test('la suma de los premios siempre cuadra con el bote, con céntimos sueltos', () => {
  for (const entrants of [2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const buyIn of [7, 33, 99, 101, 1000]) {
      const p = prizePayout({ buyIn, entrants, rakeRate: DEFAULT_RAKE, split: DEFAULT_SPLIT });
      const sum = p.places.reduce((a, x) => a + x.amount, 0);
      assert.equal(
        Math.round(sum * 100),
        Math.round(p.prizePool * 100),
        `entrants=${entrants} buyIn=${buyIn}`
      );
      assert.ok(
        Math.round(sum * 100) <= Math.round(p.prizePool * 100),
        'nunca se reparte más que el bote'
      );
    }
  }
});
