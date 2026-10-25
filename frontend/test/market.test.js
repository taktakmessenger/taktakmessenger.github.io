import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  categoryLabel,
  conditionLabel,
  formatPrice,
  relativeTime,
  canManageListing,
  MAX_PHOTOS,
} from '../src/lib/market.js';

// Estas reglas deciden qué se ve en Marketak: la etiqueta de una categoría, el
// formato del precio y qué botones de gestión aparecen. Se prueban sin DOM.

test('toda categoría del backend tiene etiqueta', () => {
  // Deben coincidir con el `enum` del modelo Listing.
  const categories = [
    'electronica', 'ropa', 'hogar', 'vehiculos', 'servicios', 'mascotas', 'otros',
  ];
  for (const value of categories) {
    assert.ok(CATEGORY_LABELS[value], `falta la etiqueta de ${value}`);
  }
});

test('una categoría desconocida cae en Otros', () => {
  assert.equal(categoryLabel('inventada'), CATEGORY_LABELS.otros);
  assert.equal(categoryLabel(undefined), CATEGORY_LABELS.otros);
});

test('una condición desconocida se muestra tal cual', () => {
  assert.equal(conditionLabel('nuevo'), 'Nuevo');
  assert.equal(conditionLabel('como_nuevo'), 'Como nuevo');
  assert.equal(conditionLabel('raro'), 'raro');
});

test('el precio se muestra en TTC', () => {
  assert.equal(formatPrice(500), '500 TTC');
  assert.equal(formatPrice(0), '0 TTC');
  assert.match(formatPrice(1234), /TTC$/);
});

test('el tiempo relativo resume los últimos días', () => {
  const now = Date.now();
  assert.equal(relativeTime(now, now), 'ahora');
  assert.equal(relativeTime(now - 5 * 60 * 1000, now), 'hace 5 min');
  assert.equal(relativeTime(now - 3 * 60 * 60 * 1000, now), 'hace 3 h');
  assert.equal(relativeTime(now - 2 * 24 * 60 * 60 * 1000, now), 'hace 2 d');
});

test('el vendedor puede gestionar su anuncio', () => {
  const listing = { seller: { _id: 'abc' } };
  assert.equal(canManageListing({ id: 'abc' }, listing), true);
});

test('un administrador puede gestionar cualquier anuncio', () => {
  const listing = { seller: { _id: 'abc' } };
  assert.equal(canManageListing({ id: 'otro', role: 'admin' }, listing), true);
});

test('otra persona no puede gestionar el anuncio ajeno', () => {
  const listing = { seller: { _id: 'abc' } };
  assert.equal(canManageListing({ id: 'otro' }, listing), false);
  assert.equal(canManageListing(null, listing), false);
  assert.equal(canManageListing({ id: 'abc' }, null), false);
});

test('el límite de fotos es el mismo que el del servidor', () => {
  assert.equal(MAX_PHOTOS, 8);
});
