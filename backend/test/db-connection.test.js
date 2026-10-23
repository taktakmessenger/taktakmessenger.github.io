const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const db = require('../src/config/db');

// Estas pruebas ejercitan el reintento de conexión de verdad, con un
// `connectFn` que falla como falla Mongo cuando no está. No se usa una base de
// datos falsa: lo que se comprueba es la lógica de reintento y de estado, que es
// justo lo que decide si el despliegue arranca o se cae en bucle.

test('connectWithRetry reintenta y termina conectando cuando el fallo es pasajero', async () => {
  let intentos = 0;
  const errores = [];

  const conectado = await db.connectWithRetry({
    delayMs: 5,
    connectFn: async () => {
      intentos += 1;
      if (intentos < 3) throw new Error('Mongo no responde todavía');
    },
    onError: (error, attempt) => errores.push(attempt),
  });

  assert.equal(conectado, true, 'debe acabar conectando');
  assert.equal(intentos, 3, 'debe haber reintentado hasta el tercer intento');
  assert.deepEqual(errores, [1, 2], 'debe avisar de cada fallo antes de lograrlo');
});

test('connectWithRetry deja de intentarlo si se alcanza el límite de intentos', async () => {
  let intentos = 0;

  const conectado = await db.connectWithRetry({
    attempts: 3,
    delayMs: 1,
    connectFn: async () => {
      intentos += 1;
      throw new Error('sin base de datos');
    },
  });

  assert.equal(conectado, false, 'debe rendirse tras el límite');
  assert.equal(intentos, 3, 'debe haber hecho exactamente los intentos pedidos');
});

test('connectWithRetry no reintenta durante un apagado', async () => {
  let intentos = 0;

  // `disconnect()` marca el apagado y luego cierra. Aquí solo interesa la marca:
  // si el proceso se está apagando, un reintento solo alargaría la salida.
  db.markShuttingDown();

  const conectado = await db.connectWithRetry({
    delayMs: 1,
    connectFn: async () => {
      intentos += 1;
      throw new Error('no debería llegar aquí');
    },
  });

  assert.equal(conectado, false, 'un apagado no conecta');
  assert.equal(intentos, 0, 'no debe intentar nada durante el apagado');
});

test('isConnected refleja el estado real de mongoose', () => {
  const original = mongoose.connection.readyState;

  mongoose.connection.readyState = 1;
  assert.equal(db.isConnected(), true, 'readyState 1 es conectado');

  mongoose.connection.readyState = 0;
  assert.equal(db.isConnected(), false, 'readyState 0 es desconectado');

  mongoose.connection.readyState = original;
});
