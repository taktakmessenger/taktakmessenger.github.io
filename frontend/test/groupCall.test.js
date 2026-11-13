import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvitees, GROUP_CALL_MAX } from '../src/lib/groupCall.js';

test('no te invitas a ti mismo', () => {
  const ids = normalizeInvitees(['a', 'yo', 'b'], 'yo');
  assert.deepEqual(ids, ['a', 'b']);
});

test('invitar dos veces a la misma persona no ocupa dos plazas', () => {
  const ids = normalizeInvitees(['a', 'a', 'b'], 'yo');
  assert.deepEqual(ids, ['a', 'b']);
});

test('acepta objetos con id y con _id', () => {
  const ids = normalizeInvitees([{ id: 'a' }, { _id: 'b' }], 'yo');
  assert.deepEqual(ids, ['a', 'b']);
});

test('quita valores vacíos', () => {
  const ids = normalizeInvitees(['a', '', null, undefined, 'b'], 'yo');
  assert.deepEqual(ids, ['a', 'b']);
});

test('recorta al tope porque quien llama ocupa una plaza', () => {
  const ids = normalizeInvitees(['a', 'b', 'c', 'd', 'e'], 'yo');
  assert.equal(ids.length, GROUP_CALL_MAX - 1);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('sin gente no hay a quién invitar', () => {
  assert.deepEqual(normalizeInvitees([], 'yo'), []);
  assert.deepEqual(normalizeInvitees(undefined, 'yo'), []);
  assert.deepEqual(normalizeInvitees(['yo'], 'yo'), []);
});
