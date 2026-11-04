const test = require('node:test');
const assert = require('node:assert/strict');
const {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  registerUser,
  setWallet,
} = require('./helpers');
const User = require('../src/models/User');
const Transaction = require('../src/models/Transaction');
const poker = require('../src/services/pokerService');
const wallet = require('../src/services/walletService');

// La mesa se juega contra un mongod real: la compra de fichas, la comisión y la
// devolución pasan por el monedero de verdad, no por dobles.

test.before(async () => connectTestDb());
test.beforeEach(async () => {
  await resetDb();
  poker._reset();
});
test.after(async () => disconnectTestDb());

async function makeUser(name, coins) {
  const { user } = await registerUser(require('./helpers').app(), { username: name });
  await setWallet(user.id, { ttcC: coins, bonusC: 0 });
  return user;
}

test('sentarse cobra la entrada del monedero y la convierte en fichas', async () => {
  const host = 'host-1';
  const user = await makeUser('ana', 1000);
  const player = await poker.sitDown(host, user.id, 'ana', 500);

  assert.equal(player.stack, 500);
  assert.equal(player.paidStack, 500, 'las monedas pagadas respaldan la pila');

  const after = await User.findById(user.id).select('wallet');
  assert.equal(after.wallet.ttcC, 500, 'se descontaron 500 del monedero');
});

test('sin monedas suficientes no se sienta y no se cobra nada', async () => {
  const user = await makeUser('luis', 100);
  await assert.rejects(() => poker.sitDown('host-1', user.id, 'luis', 500), /insuficientes/i);
  const after = await User.findById(user.id).select('wallet');
  assert.equal(after.wallet.ttcC, 100);
  assert.equal(poker.getTable('host-1').seatedCount(), 0, 'no queda asiento ocupado');
});

test('al levantarse vuelven las fichas al monedero', async () => {
  const user = await makeUser('eva', 1000);
  await poker.sitDown('host-1', user.id, 'eva', 500);
  const out = await poker.standUp('host-1', user.id);

  assert.equal(out.chips, 500);
  assert.equal(out.paid, 500);
  const after = await User.findById(user.id).select('wallet');
  assert.equal(after.wallet.ttcC, 1000, 'recupera todo lo que puso');
});

test('la comisión se acumula y se liquida al administrador al cerrar la sala', async () => {
  const admin = await registerUser(require('./helpers').app(), { username: 'jefe' });
  await User.updateOne({ _id: admin.user.id }, { $set: { role: 'admin' } });
  const player = await makeUser('ana', 5000);

  const host = 'host-1';
  await poker.sitDown(host, player.id, 'ana', 1000);
  // Se simulan dos manos terminadas con una comisión de 10 y 5 monedas pagadas.
  poker.accrueRake(host, { paid: 10, bonus: 0 });
  poker.accrueRake(host, { paid: 5, bonus: 0 });
  assert.deepEqual(poker.stats(host), { paid: 15, bonus: 0, hands: 2 });

  const settled = await poker.settleRake(host);
  assert.equal(settled.paid, 15);

  const adminAfter = await User.findById(admin.user.id).select('wallet');
  assert.equal(adminAfter.wallet.ttcC, 15, 'el administrador cobra la comisión');

  const entries = await Transaction.find({ type: 'poker_rake' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, 15);
});

test('cerrar la mesa devuelve las fichas a todos y liquida la comisión', async () => {
  const admin = await registerUser(require('./helpers').app(), { username: 'jefe' });
  await User.updateOne({ _id: admin.user.id }, { $set: { role: 'admin' } });
  const a = await makeUser('ana', 5000);
  const b = await makeUser('luis', 5000);

  await poker.sitDown('host-1', a.id, 'ana', 1000);
  await poker.sitDown('host-1', b.id, 'luis', 1000);
  poker.accrueRake('host-1', { paid: 20, bonus: 0 });

  const { settled, refunded } = await poker.closeTable('host-1');
  assert.equal(settled.paid, 20);
  assert.equal(refunded.length, 2);
  assert.equal(poker.getTable('host-1'), null, 'la mesa se borra');

  const aAfter = await User.findById(a.id).select('wallet');
  const bAfter = await User.findById(b.id).select('wallet');
  assert.equal(aAfter.wallet.ttcC, 5000);
  assert.equal(bAfter.wallet.ttcC, 5000);
  const adminAfter = await User.findById(admin.user.id).select('wallet');
  assert.equal(adminAfter.wallet.ttcC, 20);
});

test('la comisión se guarda hasta que exista un administrador', async () => {
  const player = await makeUser('ana', 5000);
  await poker.sitDown('host-1', player.id, 'ana', 1000);
  poker.accrueRake('host-1', { paid: 7, bonus: 0 });

  // Sin admin no se puede liquidar; la comisión no se pierde.
  const none = await poker.settleRake('host-1');
  assert.equal(none, null);
  assert.equal(poker.stats('host-1').paid, 7);
});

test('la comisión de monedas de regalo no se convierte en monedas pagadas', async () => {
  const admin = await registerUser(require('./helpers').app(), { username: 'jefe' });
  await User.updateOne({ _id: admin.user.id }, { $set: { role: 'admin' } });
  await poker.sitDown('host-1', (await makeUser('ana', 5000)).id, 'ana', 1000);
  poker.accrueRake('host-1', { paid: 0, bonus: 12 });
  await poker.settleRake('host-1');

  const adminAfter = await User.findById(admin.user.id).select('wallet');
  assert.equal(adminAfter.wallet.ttcC, 0, 'nada de ingreso real');
  // El administrador recibe el bono de bienvenida (100) más la comisión de
  // regalo (12): la comisión sigue siendo moneda de regalo.
  assert.equal(adminAfter.wallet.bonusC, 112);
});

test('el servicio expone la comisión configurada (1%)', () => {
  assert.equal(poker.rakeRateFor(), 0.01);
  assert.equal(wallet.round2(0.01 * 100), 1);
});
