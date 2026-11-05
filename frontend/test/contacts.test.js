import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactsApiAvailable,
  shouldAutoSync,
  flattenContacts,
  mergeContacts,
  loadCache,
  saveCache,
  SYNC_INTERVAL_MS,
} from '../src/lib/contacts.js';

// Almacenamiento falso en memoria: el helper no debe tocar el localStorage real
// para poder probar el respaldo de la caché sin navegador.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('sin la API de contactos no se intenta sincronizar sola', () => {
  assert.equal(contactsApiAvailable({}), false);
  assert.equal(contactsApiAvailable(null), false);
  assert.equal(contactsApiAvailable({ contacts: {} }), false);
  assert.equal(contactsApiAvailable({ contacts: { select: () => {} } }), true);
});

test('no sincroniza sola si el permiso no se concedió nunca', () => {
  assert.equal(shouldAutoSync({ available: true, granted: false, lastSync: 0, now: 1e12 }), false);
});

test('no sincroniza sola si el navegador no da la agenda', () => {
  assert.equal(shouldAutoSync({ available: false, granted: true, lastSync: 0, now: 1e12 }), false);
});

test('sincroniza sola si ya hay permiso y pasó el intervalo', () => {
  const now = 1e12;
  assert.equal(
    shouldAutoSync({ available: true, granted: true, lastSync: now - SYNC_INTERVAL_MS - 1, now }),
    true
  );
});

test('no vuelve a sincronizar dentro del intervalo', () => {
  const now = 1e12;
  assert.equal(
    shouldAutoSync({ available: true, granted: true, lastSync: now - 1000, now }),
    false
  );
});

test('aplana la agenda a una fila por teléfono', () => {
  const picked = [
    { name: ['Ana'], tel: ['+34600111222', '+34600333444'] },
    { name: ['Beto'], tel: ['+584121234567'] },
  ];
  const list = flattenContacts(picked);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { name: 'Ana', phone: '+34600111222', source: 'device' });
  assert.equal(list.filter((c) => c.name === 'Ana').length, 2);
});

test('descarta contactos sin teléfono y teléfonos vacíos', () => {
  const list = flattenContacts([
    { name: ['Sin tel'], tel: [] },
    { name: ['Con hueco'], tel: ['', '  ', '+34600555666'] },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, '+34600555666');
});

test('un contacto sin nombre no queda sin etiqueta', () => {
  const list = flattenContacts([{ name: [], tel: ['+34600777888'] }]);
  assert.equal(list[0].name, 'Sin nombre');
});

test('fusiona sin duplicar y los manuales tienen prioridad', () => {
  const device = [
    { name: 'Ana', phone: '+34600111222', source: 'device' },
    { name: 'Beto', phone: '+584121234567', source: 'device' },
  ];
  const manual = [{ name: 'Ana', phone: '+34600111222', manual: true }];
  const merged = mergeContacts(device, manual);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((c) => c.name === 'Ana').manual, true);
});

test('sincronizar dos veces no acumula repetidos', () => {
  const device = [{ name: 'Ana', phone: '+34600111222', source: 'device' }];
  const once = mergeContacts(device, []);
  const twice = mergeContacts(device, once);
  assert.equal(twice.length, 1);
});

test('la caché sobrevive a un guardado y una lectura', () => {
  const storage = fakeStorage();
  const list = [{ name: 'Ana', phone: '+34600111222', source: 'device' }];
  saveCache(list, 1234, storage);
  const { list: read, lastSync } = loadCache(storage);
  assert.deepEqual(read, list);
  assert.equal(lastSync, 1234);
});

test('una caché corrupta no rompe el marcador', () => {
  const storage = fakeStorage({ taktak_contacts_cache: '{no es json' });
  assert.deepEqual(loadCache(storage), { list: [], lastSync: 0 });
});
