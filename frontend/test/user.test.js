import test from 'node:test';
import assert from 'node:assert/strict';
import { userId, normalizeUser } from '../src/lib/user.js';

// El helper normaliza la forma del usuario, que llega con `_id` desde unas
// rutas y con `id` desde otras. Sin esto, `user.id` es `undefined` en media app.

test('userId prefiere _id pero acepta id', () => {
  assert.equal(userId({ _id: 'abc', id: 'def' }), 'abc');
  assert.equal(userId({ id: 'def' }), 'def');
  assert.equal(userId({ _id: 'abc' }), 'abc');
});

test('userId no explota con nulos', () => {
  assert.equal(userId(null), null);
  assert.equal(userId(undefined), null);
  assert.equal(userId({}), null);
});

test('normalizeUser deja siempre un id legible', () => {
  const u = normalizeUser({ _id: 'abc', username: 'ana' });
  assert.equal(u.id, 'abc');
  assert.equal(u._id, 'abc', 'conserva _id por si alguien lo lee');
  assert.equal(u.username, 'ana');
});

test('normalizeUser no toca el id si ya venía', () => {
  const u = normalizeUser({ id: 'xyz', username: 'bob' });
  assert.equal(u.id, 'xyz');
});

test('normalizeUser devuelve tal cual un valor vacío', () => {
  assert.equal(normalizeUser(null), null);
  assert.equal(normalizeUser(undefined), undefined);
});
