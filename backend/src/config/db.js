const mongoose = require('mongoose');
const env = require('./env');

async function connect(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  return mongoose.connection;
}

// Un `disconnect()` deja la conexión cerrada a propósito; sin esta marca, el
// reintento de abajo intentaría reconectar un cierre deliberado.
let shuttingDown = false;

function markShuttingDown() {
  shuttingDown = true;
}

// Se consulta en `/health`. `readyState === 1` es "conectado": mongoose lo baja
// solo cuando el servidor se cae, así que refleja la realidad y no lo que
// creíamos al arrancar.
function isConnected() {
  return mongoose.connection.readyState === 1;
}

// Reintenta la conexión hasta que el servidor responda.
//
// En un despliegue gestionado el arranque no depende solo de nosotros: Mongo
// puede estar en un servicio externo que aún no acepta conexiones (lista de IPs
// sin actualizar, una instancia gratuita que se durmió, una red que tarda). Si
// esto fuese fatal, el proceso moriría, el puerto no se abriría y el despliegue
// fallaría en bucle. Reintentar deja la API en pie y la conecta sola cuando el
// servidor aparezca, sin volver a desplegar.
async function connectWithRetry({
  attempts = 0,
  delayMs = 5000,
  onError,
  connectFn = connect,
} = {}) {
  let attempt = 0;
  for (;;) {
    if (shuttingDown) return false;
    attempt += 1;
    try {
      await connectFn();
      return true;
    } catch (error) {
      if (onError) onError(error, attempt);
      // `attempts = 0` significa "sin límite": el despliegue se queda intentando.
      if (attempts > 0 && attempt >= attempts) return false;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Multi-document transactions require a replica set or a mongos router. We
// probe once and cache, because attempting `withTransaction` on a standalone
// server applies the writes and *then* throws, which would double-apply any
// fallback path.
let transactionsSupported = null;

async function supportsTransactions() {
  if (transactionsSupported !== null) return transactionsSupported;

  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    transactionsSupported = false;
  }

  if (!transactionsSupported) {
    console.warn(
      '[db] MongoDB standalone detectado: las transferencias usan escritura compensatoria en lugar de transacciones'
    );
  }
  return transactionsSupported;
}

// Test seam so a suite can force either path.
function _setTransactionsSupported(value) {
  transactionsSupported = value;
}

async function disconnect() {
  markShuttingDown();
  await mongoose.connection.close();
}

module.exports = {
  connect,
  connectWithRetry,
  disconnect,
  isConnected,
  markShuttingDown,
  supportsTransactions,
  _setTransactionsSupported,
};
