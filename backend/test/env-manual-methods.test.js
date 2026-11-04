const test = require('node:test');
const assert = require('node:assert/strict');

// El parser de métodos de cobro manual solo corre al cargar `config/env`, así que
// cada caso recarga el módulo con un valor distinto de MANUAL_PAYMENT_METHODS.
// Se prueba aquí porque los tests de la API inyectan los métodos ya parseados y
// se saltarían justo esta parte (la que sanea el enlace).
process.env.NODE_ENV = 'test';

function loadEnv(rawValue) {
  if (rawValue === undefined) delete process.env.MANUAL_PAYMENT_METHODS;
  else process.env.MANUAL_PAYMENT_METHODS = rawValue;

  const envPath = require.resolve('../src/config/env');
  delete require.cache[envPath];
  return require(envPath);
}

test('un enlace http(s) se conserva', () => {
  const env = loadEnv(JSON.stringify([
    { id: 'paypal', label: 'PayPal', link: 'https://paypal.me/eliecerdepablos', details: 'Paga y pega la operación.' },
  ]));

  assert.equal(env.manualPaymentMethods[0].link, 'https://paypal.me/eliecerdepablos');
  assert.equal(env.manualPaymentMethods[0].details, 'Paga y pega la operación.');
});

test('un enlace que no sea http(s) se descarta', () => {
  const env = loadEnv(JSON.stringify([
    { id: 'trampa', label: 'Trampa', link: 'javascript:alert(1)' },
  ]));

  // No se confía en el front para filtrar: un `javascript:` acabaría siendo un
  // botón ejecutable en la tienda.
  assert.equal(env.manualPaymentMethods[0].link, '');
});

test('sin enlace queda vacío', () => {
  const env = loadEnv(JSON.stringify([{ id: 'efectivo', label: 'Efectivo' }]));

  assert.equal(env.manualPaymentMethods[0].link, '');
});

test('payTo se conserva y se recorta', () => {
  const env = loadEnv(JSON.stringify([
    { id: 'zinli', label: 'Zinli', link: 'https://recargas.zinli.com/x', payTo: '  eliecerdepablos@gmail.com  ' },
  ]));

  assert.equal(env.manualPaymentMethods[0].payTo, 'eliecerdepablos@gmail.com');
});

test('sin payTo queda vacío', () => {
  const env = loadEnv(JSON.stringify([{ id: 'zinli', label: 'Zinli' }]));

  assert.equal(env.manualPaymentMethods[0].payTo, '');
});

test('sin métodos configurados la lista queda vacía', () => {
  const env = loadEnv(undefined);

  assert.deepEqual(env.manualPaymentMethods, []);
});

test('un JSON inválido falla al arrancar', () => {
  assert.throws(() => loadEnv('no-es-json'), /valid JSON/);
});
