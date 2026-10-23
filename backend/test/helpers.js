// Set before any module is loaded: `config/env` reads NODE_ENV at require time,
// and the auth rate limiters use it to decide whether to throttle.
process.env.NODE_ENV = 'test';
// La conversión HLS se prueba de extremo a extremo en scripts/, no aquí: los
// tests de la API no deben depender de que ffmpeg esté instalado en la máquina
// que los ejecuta.
process.env.TRANSCODE_ENABLED = 'false';

const mongoose = require('mongoose');
const request = require('supertest');
const createApp = require('../src/app');

// Tests run against a real mongod (not a mock) so the atomicity guarantees in
// walletService are actually exercised. Point TEST_MONGODB_URI at a throwaway
// database.
const TEST_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/taktak_test';

async function connectTestDb() {
  await mongoose.connect(TEST_URI);
}

async function resetDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

const app = () => request(createApp());

async function registerUser(agent, overrides = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const payload = {
    username: overrides.username || `user_${suffix}`,
    email: overrides.email || `user_${suffix}@example.com`,
    password: overrides.password || 'secret123',
  };
  const res = await agent.post('/api/auth/register').send(payload);
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { ...payload, token: res.body.token, user: res.body.user };
}

// Pins a wallet's buckets exactly. Tests that exercise the cashable path need
// paid coins, and the welcome bonus would otherwise be spent first and mask it.
async function setWallet(userId, { ttcC, bonusC, ttcR } = {}) {
  const User = require('../src/models/User');
  const set = {};
  if (ttcC !== undefined) set['wallet.ttcC'] = ttcC;
  if (bonusC !== undefined) set['wallet.bonusC'] = bonusC;
  if (ttcR !== undefined) set['wallet.ttcR'] = ttcR;
  await User.updateOne({ _id: userId }, { $set: set });
}

module.exports = {
  connectTestDb,
  resetDb,
  disconnectTestDb,
  app,
  registerUser,
  setWallet,
  TEST_URI,
};
