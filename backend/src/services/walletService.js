const mongoose = require('mongoose');
const User = require('../models/User');
const Video = require('../models/Video');
const Gift = require('../models/Gift');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const db = require('../config/db');
const { HttpError } = require('../utils/http');

/**
 * Debit `amount` from a user's spendable coins, only if the total covers it.
 *
 * Paid coins (`ttcC`) are spent first and promotional coins (`bonusC`) last.
 * The ordering is deliberate: a gift is only ever funded by bonus coins once the
 * sender has no paid coins left, so a paying user's gift is never silently
 * downgraded to non-cashable for the creator. A free account has no paid coins,
 * so its gifts are always bonus-funded and stay inside the closed loop.
 *
 * The update is guarded with `$gte` on each bucket it touches, so it can never
 * drive a balance negative: if a concurrent gift got there first, no document
 * matches, the loop re-reads and recomputes. Conditions are only added for the
 * buckets actually being spent, so accounts predating `bonusC` (no such field)
 * keep working.
 *
 * Returns the updated user plus how the amount split across buckets, which
 * `sendGift` needs to credit the right kind of coin.
 */
async function debitSpendable(userId, amount) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const user = await User.findById(userId).select('wallet');
    if (!user) return null;

    const bonus = user.wallet.bonusC || 0;
    const paid = user.wallet.ttcC || 0;
    if (bonus + paid < amount) return null;

    const paidUsed = Math.min(amount, paid);
    const bonusUsed = round2(amount - paidUsed);

    const filter = { _id: userId };
    const inc = {};
    if (bonusUsed > 0) {
      filter['wallet.bonusC'] = { $gte: bonusUsed };
      inc['wallet.bonusC'] = -bonusUsed;
    }
    if (paidUsed > 0) {
      filter['wallet.ttcC'] = { $gte: paidUsed };
      inc['wallet.ttcC'] = -paidUsed;
    }

    const updated = await User.findOneAndUpdate(filter, { $inc: inc }, { new: true });
    if (updated) return { user: updated, bonusUsed, paidUsed };
  }
  return null;
}

/**
 * Credit a recipient's balances. `ttcR` is withdrawable Diamonds and only ever
 * comes from paid coins; `bonusC` is spend-only and comes from bonus coins.
 * `stats.totalGiftsReceived` counts the gift once, regardless of split.
 */
async function creditWithdrawable(userId, { ttcR = 0, bonusC = 0 } = {}, session) {
  const inc = { 'stats.totalGiftsReceived': 1 };
  if (ttcR) inc['wallet.ttcR'] = ttcR;
  if (bonusC) inc['wallet.bonusC'] = bonusC;
  return User.findOneAndUpdate({ _id: userId }, { $inc: inc }, { new: true, session });
}

/**
 * Devuelve monedas gastables a un usuario, cada tipo a su cubo. Se usa al salir
 * de una mesa de POKERTAK: las fichas respaldadas por monedas pagadas vuelven
 * como pagadas y las de regalo como regalo, para no convertir una en otra.
 */
async function creditSpendable(userId, { ttcC = 0, bonusC = 0 } = {}, session) {
  const inc = {};
  if (ttcC) inc['wallet.ttcC'] = ttcC;
  if (bonusC) inc['wallet.bonusC'] = bonusC;
  if (Object.keys(inc).length === 0) return User.findById(userId);
  return User.findOneAndUpdate({ _id: userId }, { $inc: inc }, { new: true, session });
}

/**
 * Resolve a gift to the amount to charge.
 *
 * When `giftId` is supplied the price comes from the catalogue, never from the
 * request body. That closes the obvious hole in a client-supplied `giftCost`:
 * sending a 5000-coin "Corona" for 1 coin.
 */
async function resolveGift({ giftId, amount, giftName }) {
  if (giftId) {
    const gift = await Gift.findOne({ _id: giftId, isActive: true });
    if (!gift) throw new HttpError(404, 'Regalo no encontrado');
    return { amount: gift.coinCost, giftName: gift.name, giftId: gift._id };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Monto inválido');
  }
  return { amount, giftName, giftId: undefined };
}

/**
 * Send a gift from one user to another.
 *
 * The debit happens first and is the guard: if the sender cannot cover the
 * amount the whole operation aborts before any credit is applied.
 *
 * Revenue split: the creator keeps 60% and the platform takes 40%. The platform
 * share is booked as a ledger entry so the house earnings are auditable instead
 * of vanishing from the balance sheet.
 *
 * The creator's 60% is split by how the sender paid, and that split is what
 * closes the money leak. Paid coins (`ttcC`) credit withdrawable Diamonds
 * (`ttcR`) as before. Promotional coins (`bonusC`) credit spend-only coins, so a
 * gift paid with a welcome bonus can never be cashed out: it can only be gifted
 * again. Ten thousand free accounts gifting each other end up with ten thousand
 * accounts holding free coins, and not one cent leaves the platform.
 */
async function sendGift({ senderId, recipientId, amount, videoId, giftName, giftId }) {
  const gift = await resolveGift({ giftId, amount, giftName });
  amount = gift.amount;
  giftName = gift.giftName;

  if (String(senderId) === String(recipientId)) {
    throw new HttpError(400, 'No puedes enviarte un regalo a ti mismo');
  }

  const recipient = await User.findById(recipientId);
  if (!recipient) throw new HttpError(404, 'Usuario receptor no encontrado');

  const debit = await debitSpendable(senderId, amount);
  if (!debit) throw new HttpError(400, 'TTC-C insuficientes');

  // The creator share is floored to whole Diamonds; the remainder goes to the
  // platform so the two sides always sum to `amount`.
  const creatorAmount = Math.floor(amount * env.creatorShare);
  const platformAmount = round2(amount - creatorAmount);

  // Which part of the creator share is cashable. Both ratios are derived from
  // the same amount, so flooring them together never exceeds the total.
  const paidRatio = amount > 0 ? debit.paidUsed / amount : 0;
  const creatorTtcR = Math.floor(creatorAmount * paidRatio);
  const creatorBonusC = round2(creatorAmount - creatorTtcR);
  // Classified by how the sender paid, not by the resulting Diamond count: a
  // 1-coin paid gift floors to zero Diamonds but is still real revenue.
  const paidGift = debit.paidUsed > 0;

  const ledgerEntry = {
    from: senderId,
    to: recipientId,
    amount,
    // A promotional gift is booked as its own type so reports can tell cashable
    // revenue apart from bonus recirculation.
    type: paidGift ? 'gift' : 'gift_bonus',
    ttcType: 'ttcC',
    creatorAmount,
    platformAmount,
    giftName,
    giftId: gift.giftId,
    videoId,
  };

  const platformEntry = {
    from: recipientId,
    amount: platformAmount,
    // The house cut of a bonus-funded gift is bonus coins too, not revenue. It
    // is booked apart so `platformEarnings` never counts money nobody paid.
    type: paidGift ? 'platform' : 'platform_bonus',
    ttcType: 'ttcC',
    creatorAmount: 0,
    platformAmount,
    giftName,
    videoId,
  };

  await applyCreditAndLedger(
    recipientId,
    { ttcR: creatorTtcR, bonusC: creatorBonusC },
    [ledgerEntry, platformEntry],
    { refund: { userId: senderId, bonusC: debit.bonusUsed, ttcC: debit.paidUsed } }
  );

  // Engagement counters are best-effort: a failure here must not undo a gift
  // that has already been settled. Diamonds earned is what the creator sees.
  if (videoId) {
    await Video.updateOne({ _id: videoId }, { $inc: { gifts: 1, ttcEarned: creatorTtcR } });
  }

  return {
    amount,
    creatorAmount,
    creatorTtcR,
    creatorBonusC,
    platformAmount,
    giftName,
    paidGift,
    remainingCoins: debit.user.wallet.ttcC,
    remainingBonusCoins: debit.user.wallet.bonusC || 0,
  };
}

// Applies the recipient credit and the ledger entries together. On a replica set
// this is a real transaction; on standalone MongoDB the writes are sequenced
// with a compensating rollback if a later one fails.
async function applyCreditAndLedger(recipientId, credit, ledgerEntries, { refund } = {}) {
  const entries = Array.isArray(ledgerEntries) ? ledgerEntries : [ledgerEntries];

  if (await db.supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // The credit must join the session too, otherwise it commits even when
        // the ledger write fails and the creator is paid with no matching entry.
        await creditWithdrawable(recipientId, credit, session);
        // A multi-document insert with a session requires `ordered: true`.
        await Transaction.create(entries, { session, ordered: true });
      });
      return;
    } catch (err) {
      if (refund) await compensate(refund);
      throw err;
    } finally {
      await session.endSession();
    }
  }

  try {
    await creditWithdrawable(recipientId, credit);
    await Transaction.create(entries);
  } catch (err) {
    if (refund) await compensate(refund);
    throw err;
  }
}

// Restores the sender's coins if a later step in the transfer failed. Each
// bucket goes back where it came from: refunding paid coins as bonus coins (or
// the reverse) would let a failure silently convert one into the other.
async function compensate({ userId, bonusC = 0, ttcC = 0 }) {
  const inc = {};
  if (bonusC) inc['wallet.bonusC'] = bonusC;
  if (ttcC) inc['wallet.ttcC'] = ttcC;
  if (Object.keys(inc).length === 0) return;
  await User.updateOne({ _id: userId }, { $inc: inc });
}

/**
 * Métodos de cobro admitidos para un retiro. Es una lista cerrada a propósito:
 * `method` viaja desde el cliente y acaba en el registro contable, así que un
 * valor libre permitiría etiquetas arbitrarias ("banco-que-no-existe") que luego
 * nadie sabe interpretar al pagar.
 */
const PAYOUT_METHODS = ['paypal', 'zelle', 'crypto'];

/**
 * Solicita un retiro de Diamantes (TTC-R).
 *
 * Orden de las comprobaciones, de la más barata a la que toca el saldo: importe,
 * método, tope diario y, por último, el débito atómico. El débito es la guarda
 * real: el `$gte` sobre `wallet.ttcR` impide que dos solicitudes simultáneas
 * dejen el saldo en negativo.
 *
 * Los Diamantes se descuentan ya, al pedir: si se dejaran en el saldo hasta
 * pagarlos, el usuario podría gastarlos o pedir otro retiro con los mismos y la
 * suma de solicitudes superaría lo que tiene. El dinero "en vuelo" queda
 * registrado en la transacción `pending`.
 */
async function requestWithdrawal({ userId, amount, method, details }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Monto inválido');
  }
  if (amount < env.withdrawals.min) {
    throw new HttpError(400, `El mínimo para retirar es ${env.withdrawals.min} Diamantes`);
  }
  if (!PAYOUT_METHODS.includes(method)) {
    throw new HttpError(400, 'Método de retiro no admitido');
  }
  // El dato de cobro es obligatorio: un retiro sin cuenta a la que pagar se
  // queda en la cola para siempre y hay que rechazarlo a mano.
  if (!details || !String(details).trim()) {
    throw new HttpError(400, 'Indica la cuenta o los datos de cobro');
  }

  // Tope diario: se cuentan las solicitudes vivas de las últimas 24 h. Las
  // rechazadas no cuentan porque sus Diamantes ya volvieron al usuario.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recent] = await Transaction.aggregate([
    {
      $match: {
        from: new mongoose.Types.ObjectId(String(userId)),
        type: 'withdraw',
        status: { $in: ['pending', 'completed'] },
        createdAt: { $gte: since },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const used = recent?.total || 0;
  if (used + amount > env.withdrawals.dailyCap) {
    throw new HttpError(
      400,
      `Superas el tope diario de ${env.withdrawals.dailyCap} Diamantes. Ya pediste ${round2(used)} en las últimas 24 h.`
    );
  }

  const user = await User.findOneAndUpdate(
    { _id: userId, 'wallet.ttcR': { $gte: amount } },
    { $inc: { 'wallet.ttcR': -amount } },
    { new: true }
  );
  if (!user) throw new HttpError(400, 'TTC-R insuficientes');

  const transaction = await Transaction.create({
    from: userId,
    amount,
    type: 'withdraw',
    ttcType: 'ttcR',
    method,
    details: String(details).trim().slice(0, 200),
    status: 'pending',
  });

  return { amount, method, transactionId: transaction._id };
}

/**
 * Cola de retiros para el administrador. Se listan del más antiguo al más nuevo
 * (FIFO): el que lleva más esperando es el que toca pagar.
 */
async function listWithdrawals({ status, limit = 50 } = {}) {
  const query = { type: 'withdraw' };
  if (status) query.status = status;

  const withdrawals = await Transaction.find(query)
    .sort({ createdAt: 1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .populate('from', 'username profile.displayName profile.avatar');

  return withdrawals.map((w) => ({
    id: w._id,
    amount: w.amount,
    method: w.method,
    details: w.details,
    status: w.status,
    createdAt: w.createdAt,
    reviewedAt: w.reviewedAt,
    reason: w.reason,
    user: w.from
      ? {
          id: w.from._id,
          username: w.from.username,
          displayName: w.from.profile?.displayName || null,
        }
      : null,
  }));
}

/**
 * Marca un retiro como pagado.
 *
 * No mueve saldo: los Diamantes se descontaron al solicitarlo. El `status:
 * 'pending'` en el filtro es la guarda de idempotencia: si dos administradores
 * pulsan "pagar" a la vez, solo el primero actualiza algo y el segundo recibe
 * un 409 en vez de marcar dos veces el mismo pago.
 */
async function payWithdrawal({ transactionId, adminId }) {
  const withdrawal = await Transaction.findOne({ _id: transactionId, type: 'withdraw' });
  if (!withdrawal) throw new HttpError(404, 'Retiro no encontrado');
  if (withdrawal.status !== 'pending') {
    throw new HttpError(409, 'Ese retiro ya fue resuelto');
  }

  // Periodo de retención: da margen a detectar un fraude antes de sacar el
  // dinero. Con `holdHours = 0` (por defecto) no retiene nada.
  if (env.withdrawals.holdHours > 0) {
    const releasableAt = new Date(withdrawal.createdAt).getTime() + env.withdrawals.holdHours * 3600 * 1000;
    if (Date.now() < releasableAt) {
      throw new HttpError(
        409,
        `Este retiro está en retención hasta ${new Date(releasableAt).toISOString()}`
      );
    }
  }

  const updated = await Transaction.findOneAndUpdate(
    { _id: transactionId, type: 'withdraw', status: 'pending' },
    { $set: { status: 'completed', reviewedBy: adminId, reviewedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new HttpError(409, 'Ese retiro ya fue resuelto');

  return { id: updated._id, status: updated.status, amount: updated.amount, userId: updated.from };
}

/**
 * Rechaza un retiro y devuelve los Diamantes.
 *
 * La devolución va después del cambio de estado, no antes: el filtro
 * `status: 'pending'` es el que garantiza que solo se devuelve una vez. Si el
 * proceso se cortara entre las dos escrituras, quedaría un retiro rechazado sin
 * devolver, que es recuperable a mano; al revés (devolver y no cambiar el
 * estado) se podría devolver dos veces.
 */
async function rejectWithdrawal({ transactionId, adminId, reason }) {
  const withdrawal = await Transaction.findOne({ _id: transactionId, type: 'withdraw' });
  if (!withdrawal) throw new HttpError(404, 'Retiro no encontrado');
  if (withdrawal.status !== 'pending') {
    throw new HttpError(409, 'Ese retiro ya fue resuelto');
  }

  const updated = await Transaction.findOneAndUpdate(
    { _id: transactionId, type: 'withdraw', status: 'pending' },
    {
      $set: {
        status: 'rejected',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reason: reason ? String(reason).trim().slice(0, 300) : '',
      },
    },
    { new: true }
  );
  if (!updated) throw new HttpError(409, 'Ese retiro ya fue resuelto');

  await User.updateOne({ _id: updated.from }, { $inc: { 'wallet.ttcR': updated.amount } });

  return {
    id: updated._id,
    status: updated.status,
    amount: updated.amount,
    userId: updated.from,
    reason: updated.reason,
  };
}

/**
 * Convierte Monedas pagadas (`ttcC`) en Diamantes retirables (`ttcR`).
 *
 * Solo la usa el administrador: es la válvula que permite al dueño convertir
 * monedas que ya están en su cuenta. La conversión es 1 a 1 por defecto
 * (`COIN_TO_DIAMOND_RATE`), sin pasar por el reparto de regalos, y queda
 * registrada en el libro con `type: 'convert'` para poder auditarla.
 *
 * El débito va primero y con `$gte`, así que nunca deja el saldo en negativo: si
 * dos conversiones coinciden, la segunda no encuentra documento y reintenta con
 * el saldo ya actualizado.
 */
async function convertCoinsToDiamonds({ userId, coins, rate }) {
  const amount = round2(Number(coins));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Cantidad inválida');
  }

  const appliedRate = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : 1;
  const diamonds = round2(amount * appliedRate);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const user = await User.findOneAndUpdate(
      { _id: userId, 'wallet.ttcC': { $gte: amount } },
      { $inc: { 'wallet.ttcC': -amount, 'wallet.ttcR': diamonds } },
      { new: true }
    );
    if (user) {
      await Transaction.create({
        from: userId,
        to: userId,
        amount,
        type: 'convert',
        ttcType: 'ttcR',
        details: `${amount} Monedas → ${diamonds} Diamantes (tasa ${appliedRate})`,
      });
      return { coins: amount, diamonds, rate: appliedRate, wallet: user.wallet };
    }

    // El saldo no alcanzaba en este intento. Si de verdad no llega, no hay
    // nada que reintentar; se comprueba para dar un mensaje claro en vez de un
    // fallo opaco tras diez vueltas.
    const current = await User.findById(userId).select('wallet');
    if (!current) throw new HttpError(404, 'Usuario no encontrado');
    if ((current.wallet.ttcC || 0) < amount) {
      throw new HttpError(
        400,
        `No tienes suficientes Monedas: ${round2(current.wallet.ttcC || 0)} disponibles, ${amount} pedidas`
      );
    }
  }

  throw new HttpError(409, 'No se pudo completar la conversión, inténtalo de nuevo');
}

async function getWallet(userId) {
  const user = await User.findById(userId).select('wallet stats');
  if (!user) throw new HttpError(404, 'Usuario no encontrado');

  return {
    // Branded names first, then the internal bucket names kept for
    // compatibility with existing clients and tests.
    coins: user.wallet.ttcC,
    bonusCoins: user.wallet.bonusC || 0,
    diamonds: user.wallet.ttcR,
    ttcC: user.wallet.ttcC,
    ttcR: user.wallet.ttcR,
    totalTTC: round2((user.wallet.ttcC || 0) + (user.wallet.ttcR || 0)),
    // Everything the user can still spend on gifts, paid plus promotional.
    spendable: round2((user.wallet.ttcC || 0) + (user.wallet.bonusC || 0)),
    stats: user.stats,
  };
}

// Total the platform has actually earned from the 40% cut. Bonus-funded gifts
// are excluded: their cut is promotional coins, not money anyone paid.
async function getPlatformEarnings() {
  const [row] = await Transaction.aggregate([
    { $match: { type: 'platform' } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return { total: round2(row?.total ?? 0), gifts: row?.count ?? 0 };
}

async function listTransactions(userId, limit = 50) {
  return Transaction.find({ $or: [{ from: userId }, { to: userId }] })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  sendGift,
  requestWithdrawal,
  listWithdrawals,
  payWithdrawal,
  rejectWithdrawal,
  convertCoinsToDiamonds,
  getWallet,
  getPlatformEarnings,
  listTransactions,
  debitSpendable,
  creditSpendable,
  creditWithdrawable,
  round2,
};
