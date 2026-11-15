// Minado de TakCoin (TKC) por ver vídeos.
//
// El minado NO acuña: mueve monedas del fondo del contrato a la wallet del
// minero, y solo si el oráculo firma el vale. La parte de aquí es la política
// (qué cuenta como minado, con qué tope y cómo se evita el abuso); la firma la
// hace `lib/voucher` y el pago lo hace el contrato.
//
// Decisión central: las monedas minadas se acreditan como PROMOCIONALES
// (`wallet.bonusC`), nunca como pagadas ni retirables. Un regalo pagado con
// monedas minadas hace que el creador reciba monedas de regalo, así que el
// minado no puede salir del sistema como dinero. Es lo que hace que minar sea
// seguro para la economía de la app.
const User = require('../models/User');
const WatchEvent = require('../models/WatchEvent');
const Video = require('../models/Video');
const env = require('../config/env');
const { HttpError } = require('../utils/http');
const voucher = require('../lib/voucher');

const { mining } = env;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/// Reinicia los contadores si el día cambió. Devuelve el bloque `mining` al día.
function freshCounters(user) {
  const m = user.mining || {};
  if (m.day !== today()) {
    return { day: today(), minedToday: 0, videosToday: 0, rewardedVideos: [] };
  }
  return {
    day: m.day,
    minedToday: m.minedToday || 0,
    videosToday: m.videosToday || 0,
    rewardedVideos: m.rewardedVideos || [],
  };
}

/**
 * Unidades de minado de un usuario para el día de hoy, verificadas en servidor.
 *
 * Se cuentan los `WatchEvent` de las últimas 24 h: solo cuentan los vídeos
 * vistos al menos al 90% y durante `minWatchSeconds` o más. La duración del
 * vídeo es la almacenada (no la que reporta el cliente), así que no se puede
 * inflar la retención desde el móvil.
 */
async function unitsFor(userId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const events = await WatchEvent.find({ userId, createdAt: { $gte: since } })
    .select('videoId watchDuration videoDuration completed completionRate')
    .lean();

  const rewarded = new Set();
  let videos = 0;
  for (const e of events) {
    const watchedEnough = (e.watchDuration || 0) >= mining.minWatchSeconds;
    const done = e.completed === true || (e.completionRate || 0) >= 0.9;
    if (!watchedEnough || !done) continue;
    const key = String(e.videoId);
    if (rewarded.has(key)) continue;
    rewarded.add(key);
    videos += 1;
    if (videos >= mining.dailyVideoCap) break;
  }

  // El score del contrato es una suma ponderada; para el minado por vídeo se
  // mapea cada vídeo premiado a unidades de "uptime" (peso 1), que es la unidad
  // natural de una acción pasiva como ver. El resto de unidades (relay, store,
  // call, reputation) las usará el backend para otros hitos cuando existan.
  return { relay: 0, store: 0, uptime: videos, call: 0, reputation: 0 };
}

/// Configuración pública del minado. No incluye nada secreto.
function publicConfig() {
  return {
    configured: mining.configured,
    chainId: mining.chainId,
    contract: mining.contract || null,
    weights: mining.weights,
    rewardFactor: mining.rewardFactor.toString(),
    rewardPerVideo: mining.rewardPerVideo,
    dailyMiningCap: mining.dailyMiningCap,
    dailyVideoCap: mining.dailyVideoCap,
    minWatchSeconds: mining.minWatchSeconds,
  };
}

/**
 * Emite un vale firmado para cobrar el minado pendiente del usuario.
 *
 * No acredita nada por sí mismo: devuelve los datos que el frontend enviará al
 * contrato. El `reportHash` es único por (usuario, día, vídeos), así que el
 * contrato lo marca como usado y no se puede cobrar dos veces.
 */
async function issueVoucher(userId, userAddress) {
  if (!mining.configured) {
    throw new HttpError(503, 'La minería on-chain no está configurada');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(userAddress || ''))) {
    throw new HttpError(400, 'Dirección de wallet inválida');
  }

  const user = await User.findById(userId).select('mining wallet');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  const counters = freshCounters(user);
  const units = await unitsFor(userId);

  const pendingVideos = Math.max(0, units.uptime - counters.videosToday);
  const pendingCoins = pendingVideos * mining.rewardPerVideo;
  const room = Math.max(0, mining.dailyMiningCap - counters.minedToday);
  const coins = Math.min(pendingCoins, room);

  if (coins <= 0) {
    throw new HttpError(400, 'No hay minado pendiente para reclamar');
  }

  // Se mina en unidades de uptime (peso 1): `unitsForCoins` convierte los TKC a
  // los puntos que paga el contrato, así que el importe del vale coincide
  // exactamente con `rewardFor` on-chain.
  const claimUnits = voucher.unitsForCoins(coins);
  const rewardWei = voucher.rewardFor(claimUnits);
  if (rewardWei > mining.maxReward) {
    throw new HttpError(400, 'La recompensa supera el tope permitido');
  }

  const deadline = Math.floor(Date.now() / 1000) + mining.voucherTtlSeconds;
  const reportHash = voucher.reportHashFor(`${userId}:${counters.day}:${counters.videosToday}:${coins}`);
  const digest = voucher.digestFor({
    chainId: mining.chainId,
    contract: mining.contract,
    user: userAddress,
    reportHash,
    units: claimUnits,
    deadline,
  });
  const signature = await voucher.signDigest(mining.reportSignerKey, digest);

  return {
    chainId: mining.chainId,
    contract: mining.contract,
    user: userAddress,
    reportHash,
    units: claimUnits,
    coins,
    videos: pendingVideos,
    rewardWei: rewardWei.toString(),
    deadline,
    signature,
  };
}

/// Marca como cobrado lo que el vale cubrió y acredita el minado en la app.
///
/// El minado se abona como monedas PROMOCIONALES (`wallet.bonusC`): se gastan en
/// regalos pero nunca se convierten en dinero. Es la regla que hace que minar no
/// pueda sacar valor del sistema. Se llama cuando el frontend confirma que la
/// transacción `claimMiningReward` se liquidó on-chain, así que el saldo de la
/// app y el TKC de la wallet cuentan el mismo minado una sola vez.
async function markClaimed(userId, { coins, videos, txHash }) {
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  const user = await User.findById(userId).select('mining');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');
  const counters = freshCounters(user);
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'mining.day': counters.day,
        'mining.minedToday': counters.minedToday + amount,
        'mining.videosToday': Math.min(
          mining.dailyVideoCap,
          counters.videosToday + Number(videos || 0)
        ),
      },
      ...(amount > 0 ? { $inc: { 'wallet.bonusC': amount } } : {}),
    }
  );
  return { credited: amount, txHash: txHash || null };
}

/// Quema TKC del fondo del contrato, con la clave del oráculo.
///
/// Es la palanca deflacionaria: quema saldo que no se va a repartir y hace la
/// oferta neta más escasa. Necesita un RPC (`RPC_URL`) porque la firma la manda
/// el propio servidor, no el usuario. Solo la puede llamar un admin (la ruta lo
/// protege), y el contrato solo acepta la firma del oráculo.
async function burnFromPool(amountTkc) {
  if (!mining.canBurn) {
    throw new HttpError(503, 'La quema no está configurada (falta RPC_URL)');
  }
  const amount = Number(amountTkc);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Cantidad de quema inválida');
  }
  const { ethers } = require('ethers');
  const provider = new ethers.JsonRpcProvider(mining.rpcUrl);
  const oracle = new ethers.Wallet(mining.reportSignerKey, provider);
  const token = new ethers.Contract(
    mining.contract,
    ['function burnFromPool(uint256)', 'function rewardPool() view returns (uint256)'],
    oracle
  );
  const value = ethers.parseUnits(String(amount), 18);
  const pool = await token.rewardPool();
  if (value > pool) throw new HttpError(400, 'La quema supera el fondo disponible');
  const tx = await token.burnFromPool(value);
  const receipt = await tx.wait();
  return { burned: amount, txHash: receipt.hash };
}

module.exports = { publicConfig, issueVoucher, markClaimed, unitsFor, freshCounters, burnFromPool };
