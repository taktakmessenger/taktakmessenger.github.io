import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guestColumns,
  guestRows,
  orderParticipants,
  isLiveFull,
} from '../src/lib/liveGrid.js';

// El helper de la rejilla del directo son funciones puras: no tocan el DOM ni
// la red, así que se prueba la lógica de verdad (columnas, orden, aforo) sin
// navegador.

test('pocos invitados usan pocas columnas para que cada ventana sea grande', () => {
  assert.equal(guestColumns(0), 1);
  assert.equal(guestColumns(1), 1);
  assert.equal(guestColumns(2), 2);
  assert.equal(guestColumns(4), 2);
});

test('a partir de nueve invitados se añade una columna', () => {
  assert.equal(guestColumns(5), 3);
  assert.equal(guestColumns(9), 3);
  assert.equal(guestColumns(10), 4);
  assert.equal(guestColumns(20), 4);
});

test('las filas son las necesarias para repartir a todos', () => {
  assert.equal(guestRows(0), 0);
  assert.equal(guestRows(1, 1), 1);
  assert.equal(guestRows(5, 3), 2);
  assert.equal(guestRows(9, 3), 3);
  assert.equal(guestRows(20, 4), 5);
});

test('el anfitrión va primero y los invitados después', () => {
  const people = [
    { id: '3', username: 'carol' },
    { id: '1', username: 'ana' },
    { id: '2', username: 'bob' },
  ];
  const { host, guests } = orderParticipants(people, '2');
  assert.equal(host.username, 'bob');
  assert.deepEqual(
    guests.map((g) => g.username),
    ['ana', 'carol']
  );
});

test('sin anfitrión presente, todos son invitados', () => {
  const people = [{ id: '1' }, { id: '2' }];
  const { host, guests } = orderParticipants(people, '99');
  assert.equal(host, null);
  assert.equal(guests.length, 2);
});

test('el orden de los invitados es estable aunque la lista llegue desordenada', () => {
  const a = orderParticipants([{ id: 'b' }, { id: 'a' }, { id: 'c' }], 'x').guests;
  const b = orderParticipants([{ id: 'c' }, { id: 'b' }, { id: 'a' }], 'x').guests;
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
});

test('el directo se llena al alcanzar el aforo de invitados', () => {
  assert.equal(isLiveFull(19, 20), false);
  assert.equal(isLiveFull(20, 20), true);
  assert.equal(isLiveFull(21, 20), true);
});

test('un aforo sin tope (0 o vacío) nunca llena el directo', () => {
  assert.equal(isLiveFull(999, 0), false);
  assert.equal(isLiveFull(999, null), false);
  assert.equal(isLiveFull(999, undefined), false);
});
