const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb, disconnectTestDb, app, registerUser, setWallet } = require('./helpers');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/tokens');

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

async function makeAdmin() {
  return User.create({
    username: 'admin_retiros',
    email: 'admin_retiros@example.com',
    password: 'clave12345',
    role: 'admin',
  });
}

// Solicita un retiro y devuelve la transacción creada.
async function requestWithdrawal(agent, token, amount, extra = {}) {
  const res = await agent
    .post('/api/wallet/withdraw')
    .set('Authorization', `Bearer ${token}`)
    .send({ amount, method: 'paypal', details: 'cobro@example.com', ...extra });
  return res;
}

test('el administrador ve los retiros pendientes con su usuario', async () => {
  const agent = app();
  const admin = await makeAdmin();
  const user = await registerUser(agent);
  await setWallet(user.user.id, { ttcR: 500 });

  await requestWithdrawal(agent, user.token, 150);

  const res = await agent
    .get('/api/admin/withdrawals')
    .set('Authorization', `Bearer ${signToken(admin)}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.withdrawals.length, 1);
  const w = res.body.withdrawals[0];
  assert.equal(w.amount, 150);
  assert.equal(w.method, 'paypal');
  assert.equal(w.details, 'cobro@example.com');
  assert.equal(w.status, 'pending');
  assert.equal(w.user.username, user.username);
});

test('un usuario normal no puede ver la cola de retiros', async () => {
  const agent = app();
  const user = await registerUser(agent);

  const res = await agent
    .get('/api/admin/withdrawals')
    .set('Authorization', `Bearer ${user.token}`);

  assert.equal(res.status, 403);
});

test('pagar un retiro lo marca como completado sin volver a tocar el saldo', async () => {
  const agent = app();
  const admin = await makeAdmin();
  const user = await registerUser(agent);
  await setWallet(user.user.id, { ttcR: 500 });

  const created = await requestWithdrawal(agent, user.token, 150);
  assert.equal(created.status, 200);

  const pay = await agent
    .post(`/api/admin/withdrawals/${created.body.transactionId}/pay`)
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.status, 'completed');

  // El saldo no cambia al pagar: los Diamantes ya se descontaron al pedirlo.
  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(wallet.body.ttcR, 350);

  // La cola de pendientes queda vacía.
  const queue = await agent
    .get('/api/admin/withdrawals')
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(queue.body.withdrawals.length, 0);
});

test('rechazar un retiro devuelve los Diamantes al usuario', async () => {
  const agent = app();
  const admin = await makeAdmin();
  const user = await registerUser(agent);
  await setWallet(user.user.id, { ttcR: 500 });

  const created = await requestWithdrawal(agent, user.token, 150);

  const reject = await agent
    .post(`/api/admin/withdrawals/${created.body.transactionId}/reject`)
    .set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ reason: 'Cuenta de PayPal incorrecta' });
  assert.equal(reject.status, 200, JSON.stringify(reject.body));
  assert.equal(reject.body.status, 'rejected');

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(wallet.body.ttcR, 500); // devuelto íntegro
});

test('un retiro ya resuelto no se puede volver a pagar ni rechazar', async () => {
  const agent = app();
  const admin = await makeAdmin();
  const user = await registerUser(agent);
  await setWallet(user.user.id, { ttcR: 500 });

  const created = await requestWithdrawal(agent, user.token, 150);
  const id = created.body.transactionId;

  const first = await agent
    .post(`/api/admin/withdrawals/${id}/pay`)
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(first.status, 200);

  const second = await agent
    .post(`/api/admin/withdrawals/${id}/reject`)
    .set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ reason: 'tarde' });
  assert.equal(second.status, 409);

  // Y los Diamantes no se devuelven dos veces ni tras un rechazo tardío.
  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(wallet.body.ttcR, 350);
});

test('el tope diario bloquea un segundo retiro que lo supera', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const env = require('../src/config/env');
  await setWallet(user.user.id, { ttcR: env.withdrawals.dailyCap * 2 });

  const first = await requestWithdrawal(agent, user.token, env.withdrawals.dailyCap - 100);
  assert.equal(first.status, 200, JSON.stringify(first.body));

  // 200 más ya supera el tope aunque el saldo lo cubra.
  const second = await requestWithdrawal(agent, user.token, 200);
  assert.equal(second.status, 400);
  assert.match(second.body.error, /tope diario/i);
});

test('un rechazo libera el tope diario', async () => {
  const agent = app();
  const admin = await makeAdmin();
  const user = await registerUser(agent);
  const env = require('../src/config/env');
  await setWallet(user.user.id, { ttcR: env.withdrawals.dailyCap * 2 });

  const first = await requestWithdrawal(agent, user.token, env.withdrawals.dailyCap);
  assert.equal(first.status, 200);

  // Con el tope agotado, otra solicitud se rechaza.
  const blocked = await requestWithdrawal(agent, user.token, 100);
  assert.equal(blocked.status, 400);

  // Al rechazarla, sus Diamantes vuelven y el tope queda libre.
  await agent
    .post(`/api/admin/withdrawals/${first.body.transactionId}/reject`)
    .set('Authorization', `Bearer ${signToken(admin)}`)
    .send({ reason: 'prueba' });

  const again = await requestWithdrawal(agent, user.token, env.withdrawals.dailyCap);
  assert.equal(again.status, 200, JSON.stringify(again.body));
});

test('dos retiros simultáneos no pueden sobrepasar el saldo', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await setWallet(user.user.id, { ttcR: 150 });

  const [a, b] = await Promise.all([
    requestWithdrawal(agent, user.token, 100),
    requestWithdrawal(agent, user.token, 100),
  ]);

  const ok = [a, b].filter((r) => r.status === 200).length;
  assert.equal(ok, 1, 'solo una solicitud puede cubrirse con el saldo');

  const wallet = await agent
    .get('/api/wallet')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(wallet.body.ttcR, 50);
});

test('el administrador puede filtrar la cola por estado', async () => {
  const agent = app();
  const admin = await makeAdmin();
  const user = await registerUser(agent);
  await setWallet(user.user.id, { ttcR: 1000 });

  const created = await requestWithdrawal(agent, user.token, 150);
  await agent
    .post(`/api/admin/withdrawals/${created.body.transactionId}/pay`)
    .set('Authorization', `Bearer ${signToken(admin)}`);

  const completed = await agent
    .get('/api/admin/withdrawals?status=completed')
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(completed.body.withdrawals.length, 1);

  const pending = await agent
    .get('/api/admin/withdrawals?status=pending')
    .set('Authorization', `Bearer ${signToken(admin)}`);
  assert.equal(pending.body.withdrawals.length, 0);
});
