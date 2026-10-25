import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProviders, RETRY_DELAYS } from '../src/lib/providers.js';

// Las esperas reales son de segundos; en el test se sustituyen por una función
// que no duerme, para que la suite no tarde.
const noSleep = () => Promise.resolve();

test('devuelve los datos al primer intento si el servidor responde', async () => {
  let calls = 0;
  const data = await loadProviders(async () => {
    calls += 1;
    return { data: { countries: [{ code: 'ES' }], voice: false } };
  }, { sleep: noSleep });
  assert.equal(calls, 1);
  assert.deepEqual(data.countries, [{ code: 'ES' }]);
});

test('reintenta tras un fallo de arranque y acaba cargando', async () => {
  // Este es el caso que dejaba el marcador sin códigos de área: la primera
  // llamada falla porque el backend aún no está listo.
  let calls = 0;
  const data = await loadProviders(async () => {
    calls += 1;
    if (calls < 3) throw new Error('502 Bad Gateway');
    return { data: { countries: [{ code: 'MX' }] } };
  }, { sleep: noSleep });
  assert.equal(calls, 3);
  assert.deepEqual(data.countries, [{ code: 'MX' }]);
});

test('respeta los tiempos de espera crecientes entre intentos', async () => {
  const waited = [];
  await loadProviders(async () => {
    throw new Error('caído');
  }, { sleep: (ms) => { waited.push(ms); return Promise.resolve(); } }).catch(() => {});
  assert.deepEqual(waited, RETRY_DELAYS);
});

test('se rinde tras agotar los reintentos y propaga el último error', async () => {
  let calls = 0;
  await assert.rejects(
    loadProviders(async () => {
      calls += 1;
      throw new Error('sigue caído');
    }, { sleep: noSleep }),
    /sigue caído/
  );
  // Un intento inicial más uno por cada espera.
  assert.equal(calls, RETRY_DELAYS.length + 1);
});

test('se detiene si el componente se desmonta, sin seguir reintentando', async () => {
  let calls = 0;
  let mounted = true;
  const promise = loadProviders(async () => {
    calls += 1;
    mounted = false; // el usuario sale de la pantalla mientras falla
    throw new Error('caído');
  }, { sleep: noSleep, shouldAbort: () => !mounted });
  const data = await promise;
  assert.equal(data, undefined);
  assert.equal(calls, 1);
});
