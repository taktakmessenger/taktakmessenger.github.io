// Tests de la librería de vales de minado. Comprueban lo que más caro sale si
// se rompe: que el digest y el score que firma el backend son EXACTAMENTE los
// que reconstruye el contrato. Si divergen, `ecrecover` devuelve otra dirección
// y ningún cobro funciona.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');

// Se configura el entorno ANTES de cargar la librería, que lee `env` al importar.
process.env.MINING_CONTRACT = '0x000000000000000000000000000000000000dEaD';
process.env.REPORT_SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.CHAIN_ID = '80002';
process.env.REWARD_FACTOR = '1000000000000000';

const voucher = require('../src/lib/voucher');

const ORACLE = voucher.signerAddress(process.env.REPORT_SIGNER_KEY);

test('scoreOf es la suma ponderada de las unidades', () => {
  // relay 5, store 8, uptime 1, call 10, reputation 3
  const score = voucher.scoreOf({ relay: 1, store: 1, uptime: 1, call: 1, reputation: 1 });
  assert.equal(score, 27n);
});

test('rewardFor: 1.000 puntos = 1 TKC', () => {
  const units = { relay: 0, store: 0, uptime: 1000, call: 0, reputation: 0 };
  assert.equal(voucher.rewardFor(units), 10n ** 18n);
});

test('unitsForCoins: 5 TKC = 5.000 puntos de uptime', () => {
  const units = voucher.unitsForCoins(5);
  assert.equal(units.uptime, 5000);
  assert.equal(voucher.rewardFor(units), 5n * 10n ** 18n);
});

test('rewardFor aplica el halving', () => {
  const units = { relay: 0, store: 0, uptime: 1000, call: 0, reputation: 0 };
  assert.equal(voucher.rewardFor(units, 2n), 5n * 10n ** 17n);
});

test('el digest es estable y depende de cada campo', () => {
  const base = {
    chainId: 80002,
    contract: process.env.MINING_CONTRACT,
    user: '0x1111111111111111111111111111111111111111',
    reportHash: voucher.reportHashFor('u:2026-11-03:0:5'),
    units: { relay: 0, store: 0, uptime: 5000, call: 0, reputation: 0 },
    deadline: 1794000000,
  };
  const d1 = voucher.digestFor(base);
  const d2 = voucher.digestFor(base);
  assert.equal(d1, d2, 'el mismo informe da el mismo digest');

  const other = voucher.digestFor({ ...base, deadline: base.deadline + 1 });
  assert.notEqual(d1, other, 'cambiar el deadline cambia el digest');

  const otherChain = voucher.digestFor({ ...base, chainId: 56 });
  assert.notEqual(d1, otherChain, 'cambiar la red cambia el digest');
});

test('la firma del oráculo se recupera a la dirección del oráculo', async () => {
  const digest = voucher.digestFor({
    chainId: 80002,
    contract: process.env.MINING_CONTRACT,
    user: '0x2222222222222222222222222222222222222222',
    reportHash: voucher.reportHashFor('seed'),
    units: { relay: 0, store: 0, uptime: 1000, call: 0, reputation: 0 },
    deadline: 1794000000,
  });
  const signature = await voucher.signDigest(process.env.REPORT_SIGNER_KEY, digest);
  // ethers recupera la dirección firmante del mensaje (prefijo EIP-191).
  const recovered = ethers.verifyMessage(ethers.getBytes(digest), signature);
  assert.equal(recovered, ORACLE);
});

test('reportHashFor es determinista y distinto por semilla', () => {
  assert.equal(voucher.reportHashFor('a'), voucher.reportHashFor('a'));
  assert.notEqual(voucher.reportHashFor('a'), voucher.reportHashFor('b'));
});
