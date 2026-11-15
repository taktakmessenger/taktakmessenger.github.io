// Tests de integración del minado de TakCoin (TKC).
//
// Corren contra un Mongo real (como el resto de la suite) y comprueban la
// cadena completa: WatchEvents reales → vale firmado → firma verificable con la
// clave del oráculo → minado acreditado como monedas promocionales.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { ethers } = require('ethers');

// Se configura ANTES de cargar nada que lea `env` (config/env lo lee al importar).
process.env.MINING_CONTRACT = '0x000000000000000000000000000000000000dEaD';
process.env.REPORT_SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.CHAIN_ID = '80002';
process.env.REWARD_FACTOR = '1000000000000000';
process.env.MINING_REWARD_PER_VIDEO = '5';
process.env.MINING_MIN_WATCH_SECONDS = '30';

const { connectTestDb, resetDb, disconnectTestDb, app, registerUser } = require('./helpers');
const WatchEvent = require('../src/models/WatchEvent');
const User = require('../src/models/User');
const voucher = require('../src/lib/voucher');

const ORACLE = voucher.signerAddress(process.env.REPORT_SIGNER_KEY);

test.before(async () => connectTestDb());
test.beforeEach(async () => resetDb());
test.after(async () => disconnectTestDb());

/// Crea `count` vídeos vistos al 100% por el usuario, con el mínimo de segundos.
async function seedWatchedVideos(userId, count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    userId,
    videoId: new mongoose.Types.ObjectId(),
    watchDuration: 60,
    videoDuration: 60,
    completed: true,
    completionRate: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await WatchEvent.insertMany(rows);
}

test('GET /api/mining/config dice que está configurado', async () => {
  const agent = app();
  const res = await agent.get('/api/mining/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.chainId, 80002);
  assert.equal(res.body.rewardPerVideo, 5);
});

test('POST /api/mining/voucher firma un vale por los vídeos vistos', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await seedWatchedVideos(user.user.id, 2);

  const address = ethers.Wallet.createRandom().address;
  const res = await agent
    .post('/api/mining/voucher')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ address });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  // 2 vídeos × 5 TKC = 10 TKC.
  assert.equal(res.body.coins, 10);
  assert.equal(res.body.videos, 2);
  assert.equal(res.body.user, address);

  // La firma debe ser del oráculo y cubrir exactamente este vale.
  const digest = voucher.digestFor({
    chainId: 80002,
    contract: process.env.MINING_CONTRACT,
    user: address,
    reportHash: res.body.reportHash,
    units: res.body.units,
    deadline: res.body.deadline,
  });
  const recovered = ethers.verifyMessage(ethers.getBytes(digest), res.body.signature);
  assert.equal(recovered, ORACLE, 'la firma es del oráculo');

  // Y el importe que paga el contrato coincide con lo firmado.
  assert.equal(
    voucher.rewardFor(res.body.units).toString(),
    res.body.rewardWei,
    'rewardWei coincide con el score firmado'
  );
});

test('sin vídeos vistos no hay vale que firmar', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await agent
    .post('/api/mining/voucher')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ address: ethers.Wallet.createRandom().address });
  assert.equal(res.status, 400);
});

test('un vídeo corto (menos del mínimo) no cuenta', async () => {
  const agent = app();
  const user = await registerUser(agent);
  await WatchEvent.create({
    userId: user.user.id,
    videoId: new mongoose.Types.ObjectId(),
    watchDuration: 5, // por debajo del mínimo de 30 s
    videoDuration: 60,
    completed: false,
    completionRate: 0.08,
  });
  const res = await agent
    .post('/api/mining/voucher')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ address: ethers.Wallet.createRandom().address });
  assert.equal(res.status, 400);
});

test('el mismo vídeo visto dos veces solo paga una', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const videoId = new mongoose.Types.ObjectId();
  for (let i = 0; i < 2; i += 1) {
    await WatchEvent.create({
      userId: user.user.id,
      videoId,
      watchDuration: 60,
      videoDuration: 60,
      completed: true,
      completionRate: 1,
    });
  }
  const res = await agent
    .post('/api/mining/voucher')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ address: ethers.Wallet.createRandom().address });
  assert.equal(res.status, 200);
  assert.equal(res.body.coins, 5, 'un solo vídeo premiado');
});

test('POST /api/mining/claimed acredita monedas promocionales (bonusC)', async () => {
  const agent = app();
  const user = await registerUser(agent);
  // El alta regala un bono de bienvenida en `bonusC`; se parte de ahí para
  // comprobar que el minado se SUMA a las monedas de regalo y no toca las
  // pagadas ni las retirables.
  const before = await User.findById(user.user.id).select('wallet');
  const bonusBefore = before.wallet.bonusC;

  const res = await agent
    .post('/api/mining/claimed')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ coins: 15, videos: 3, txHash: '0x' + 'ab'.repeat(32) });

  assert.equal(res.status, 200);
  assert.equal(res.body.credited, 15);

  const u = await User.findById(user.user.id).select('wallet mining');
  assert.equal(u.wallet.bonusC, bonusBefore + 15, 'se suma a las monedas de regalo');
  assert.equal(u.wallet.ttcC, 0, 'no toca las monedas pagadas');
  assert.equal(u.wallet.ttcR, 0, 'no es retirable');
  assert.equal(u.mining.minedToday, 15);
});

test('el tope diario recorta el minado', async () => {
  const agent = app();
  const user = await registerUser(agent);
  // Se pone el contador del día al máximo y se comprueba que no paga más.
  await User.updateOne(
    { _id: user.user.id },
    { $set: { 'mining.day': new Date().toISOString().slice(0, 10), 'mining.minedToday': 100 } }
  );
  await seedWatchedVideos(user.user.id, 3);
  const res = await agent
    .post('/api/mining/voucher')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ address: ethers.Wallet.createRandom().address });
  assert.equal(res.status, 400, 'sin margen bajo el tope, no hay vale');
});

test('la quema está cerrada a quien no es admin', async () => {
  const agent = app();
  const user = await registerUser(agent);
  const res = await agent
    .post('/api/mining/burn')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ amount: 10 });
  assert.equal(res.status, 403, 'un usuario normal no puede quemar el fondo');
});

test('un admin sin RPC configurado recibe 503 al quemar', async () => {
  const agent = app();
  const admin = await User.create({
    username: 'adminquema',
    email: 'adminquema@example.com',
    password: 'clave12345',
    role: 'admin',
  });
  // Login real para obtener un token de admin.
  const login = await agent.post('/api/auth/login').send({ email: admin.email, password: 'clave12345' });
  const res = await agent
    .post('/api/mining/burn')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ amount: 10 });
  // En los tests no hay RPC_URL, así que la quema está apagada: 503, no un error
  // opaco ni una quema silenciosa.
  assert.equal(res.status, 503);
});
