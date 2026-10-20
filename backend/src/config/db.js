const mongoose = require('mongoose');
const env = require('./env');

async function connect(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  return mongoose.connection;
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
  await mongoose.connection.close();
}

module.exports = { connect, disconnect, supportsTransactions, _setTransactionsSupported };
