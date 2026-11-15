// Firma de "vales" de minado.
//
// El contrato TakCoin solo paga una recompensa si el vale lleva la firma del
// oráculo. Esta librería construye EXACTAMENTE el mismo digest que reconstruye
// el contrato en `claimMiningReward`: si el orden o los tipos cambian en un
// sitio y no en el otro, `ecrecover` devuelve otra dirección y el pago revierte.
//
// El digest se firma con el prefijo EIP-191 (lo que hace `signMessage` de
// ethers), que es justo lo que el contrato deshace antes de `ecrecover`.
const { ethers } = require('ethers');
const env = require('../config/env');

const TYPES = [
  'uint256', // chainId
  'address', // contract
  'address', // user
  'bytes32', // reportHash
  'uint256', // relayUnits
  'uint256', // storeUnits
  'uint256', // uptimeUnits
  'uint256', // callUnits
  'uint256', // reputationUnits
  'uint256', // deadline
];

function round(value) {
  return BigInt(Math.max(0, Math.floor(Number(value) || 0)));
}

/// Score ponderado del informe, en puntos. Idéntico al del contrato: 1 punto
/// paga `rewardFactor` wei de TKC (con 1e15, 0,001 TKC).
function scoreOf(units) {
  const w = env.mining.weights;
  return (
    round(units.relay) * BigInt(w.relay) +
    round(units.store) * BigInt(w.store) +
    round(units.uptime) * BigInt(w.uptime) +
    round(units.call) * BigInt(w.call) +
    round(units.reputation) * BigInt(w.reputation)
  );
}

/// Recompensa en wei de TKC para unas unidades, con el divisor de halving dado.
/// `halvingDivisor` es 1 al principio y se dobla en cada intervalo. Sirve para
/// que los tests comparen la cifra del backend con `rewardFor` del contrato.
function rewardFor(units, halvingDivisor = 1n) {
  const divisor = halvingDivisor <= 0n ? 1n : halvingDivisor;
  return (scoreOf(units) * env.mining.rewardFactor) / divisor;
}

/// Puntos que paga 1 TKC entero: 1e18 wei / rewardFactor. Con 1e15 son 1.000.
const pointsPerTkc = 10n ** 18n / env.mining.rewardFactor;

/// Unidades de minado que pagan `coins` TKC enteros. Se expresan como unidades
/// de "uptime" (peso 1), que es la unidad natural de una acción pasiva como ver
/// un vídeo. El score resultante coincide con el que calcula el contrato.
///
/// Devuelve números (no BigInt) para que el vale se pueda serializar a JSON sin
/// conversiones: el tope diario mantiene los valores muy por debajo del límite
/// seguro de `Number`.
function unitsForCoins(coins) {
  const uptime = Math.max(0, Math.floor(Number(coins) || 0)) * Number(pointsPerTkc);
  return { relay: 0, store: 0, uptime, call: 0, reputation: 0 };
}

/// Hash del informe. Debe ser único por (usuario, vídeo, día): es lo que impide
/// cobrar dos veces la misma recompensa (el contrato lo marca como usado).
function reportHashFor(seed) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(seed)));
}

/// Digest que firma el oráculo. Reconstruye el mismo `abi.encode` del contrato.
function digestFor({ chainId, contract, user, reportHash, units, deadline }) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(TYPES, [
      chainId,
      contract,
      user,
      reportHash,
      round(units.relay),
      round(units.store),
      round(units.uptime),
      round(units.call),
      round(units.reputation),
      deadline,
    ])
  );
}

/// Firma el digest con la clave del oráculo y devuelve la firma (65 bytes hex).
function signDigest(privateKey, digest) {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.signMessage(ethers.getBytes(digest));
}

/// Dirección pública del oráculo, para comprobar que coincide con `reportSigner`
/// del contrato desplegado.
function signerAddress(privateKey) {
  return new ethers.Wallet(privateKey).address;
}

module.exports = { scoreOf, rewardFor, unitsForCoins, pointsPerTkc, reportHashFor, digestFor, signDigest, signerAddress, TYPES };
