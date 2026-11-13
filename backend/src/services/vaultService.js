const Transaction = require('../models/Transaction');
const User = require('../models/User');
const env = require('../config/env');
const walletService = require('./walletService');
const { HttpError } = require('../utils/http');

// Bóveda y reparto del dinero.
//
// La regla que ordena todo esto: cuando alguien compra monedas, el dinero real
// no se queda entero en la app. Se parte al instante:
//
//   40% → billetera del administrador (ganancia de la plataforma)
//   60% → bóveda (dinero de los usuarios, del que salen los retiros)
//
// El 40% se reconoce como ganancia EN EL MOMENTO de la compra, no cuando se
// gasta en regalos. Así el dueño cobra su parte desde el primer segundo y no
// depende de que el usuario juegue o regale para ver su dinero.
//
// La bóveda es contabilidad: el saldo real vive en la blockchain. `vaultOwedUsd`
// es lo que la app dice deber a los usuarios; debe cuadrar con lo que hay en la
// dirección de la bóveda menos lo ya retirado.

function toUsd(priceUsd) {
  return Math.round(Number(priceUsd) * 100) / 100;
}

// Reparto 40/60 con el resto a la bóveda, para que las dos partes sumen exacto.
function split(usd) {
  const total = toUsd(usd);
  const admin = Math.round(total * env.platformShare * 100) / 100;
  const vault = Math.round((total - admin) * 100) / 100;
  return { total, admin, vault };
}

/**
 * Registra el ingreso de una compra. Es idempotente por `externalId`.
 *
 * El asiento `sale_revenue` guarda el importe bruto y el reparto en `details`,
 * así el panel puede mostrar "cuánto entró" y "cuánto es de la plataforma" sin
 * recalcular nada. No acredita monedas: eso lo hace la compra, por separado.
 */
async function recordPurchaseRevenue({ externalId, priceUsd, method, userId }) {
  const { total, admin, vault } = split(priceUsd);

  try {
    const entry = await Transaction.create({
      from: userId || undefined,
      amount: total,
      type: 'sale_revenue',
      ttcType: 'ttcC',
      method,
      amountPaid: total,
      currency: 'USD',
      externalId: `sale_${externalId}`,
      details: `Venta ${total.toFixed(2)} USD · admin ${admin.toFixed(2)} · bóveda ${vault.toFixed(2)}`,
      status: 'completed',
    });
    return { total, admin, vault, transactionId: entry._id, duplicate: false };
  } catch (error) {
    // Índice único sobre `externalId`: un reintento no suma dos veces.
    if (error && error.code === 11000) {
      return { total, admin, vault, duplicate: true };
    }
    throw error;
  }
}

/**
 * Cierra el libro de una compra ya aprobada (cobro manual o webhook).
 *
 * Se llama al acreditar las monedas. Idempotente: aprobar dos veces la misma
 * orden no vuelve a repartir el dinero.
 */
async function settlePurchase({ externalId, priceUsd, method, userId }) {
  return recordPurchaseRevenue({ externalId, priceUsd, method, userId });
}

/**
 * Estado de la bóveda para el panel.
 *
 * `adminEarningsUsd` es la ganancia acumulada de la plataforma (40% de todo lo
 * vendido). `vaultOwedUsd` es lo que la bóveda debe a los usuarios (60% de lo
 * vendido) menos lo que ya se les pagó en retiros.
 */
async function getVaultStatus() {
  const [revenue] = await Transaction.aggregate([
    { $match: { type: 'sale_revenue' } },
    { $group: { _id: null, gross: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);

  const [paidOut] = await Transaction.aggregate([
    { $match: { type: 'withdraw', status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  const gross = walletService.round2(revenue?.gross || 0);
  // La bóveda debe el 60% (la parte del creador), no el 40%: ese 40% es la
  // ganancia de la plataforma y no respalda los retiros de nadie.
  const owedUsers = walletService.round2(gross * env.creatorShare);

  return {
    network: env.crypto.network,
    adminAddress: env.crypto.adminAddress,
    vaultAddress: env.crypto.vaultAddress,
    usdtContract: env.crypto.usdtContract,
    usdtDecimals: env.crypto.usdtDecimals,
    explorer: env.crypto.explorer,
    grossSalesUsd: gross,
    sales: revenue?.count || 0,
    adminEarningsUsd: walletService.round2(gross * env.platformShare),
    vaultOwedUsd: walletService.round2(owedUsers - (paidOut?.total || 0)),
    paidOutDiamonds: walletService.round2(paidOut?.total || 0),
    payoutEnabled: env.crypto.vaultPayoutEnabled,
    configured: env.crypto.configured,
  };
}

/**
 * Botón de emergencia: el administrador mueve su ganancia hacia la "APP madre".
 *
 * Mueve la ganancia acumulada del administrador, NUNCA el dinero de los
 * usuarios: ese respalda sus Diamantes y sacarlo dejaría retiros sin fondo. Se
 * exige `confirm: true` para que no sea un clic accidental.
 */
async function emergencyTransferToMotherApp({ adminId, confirm, destination }) {
  if (!confirm) throw new HttpError(400, 'Falta la confirmación explícita');

  const status = await getVaultStatus();
  const admin = await User.findOne({ role: 'admin' }).select('_id');
  if (!admin) throw new HttpError(404, 'No hay cuenta de administrador');

  const dest = destination || env.crypto.adminAddress;
  if (!dest) throw new HttpError(400, 'No hay dirección de destino');

  await Transaction.create({
    from: admin._id,
    amount: walletService.round2(status.adminEarningsUsd),
    type: 'platform',
    ttcType: 'ttcC',
    method: 'crypto',
    details: `Transferencia a APP madre ${dest}`,
    status: 'completed',
  });

  return {
    movedUsd: status.adminEarningsUsd,
    destination: dest,
    // El dinero de los usuarios NO se toca: se devuelve para que quede claro.
    vaultOwedUsd: status.vaultOwedUsd,
    note: 'Solo se movió la ganancia del administrador; el saldo de los usuarios queda en la bóveda.',
  };
}

module.exports = {
  split,
  recordPurchaseRevenue,
  settlePurchase,
  getVaultStatus,
  emergencyTransferToMotherApp,
};
