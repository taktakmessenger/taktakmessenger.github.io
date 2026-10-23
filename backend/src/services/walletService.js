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
 * Request a withdrawal of TTC-R. The balance is debited atomically and a
 * pending transaction is recorded; actual payout is handled out of band.
 */
async function requestWithdrawal({ userId, amount, method, details }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Monto inválido');
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
    details,
    status: 'pending',
  });

  return { amount, method, transactionId: transaction._id };
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
  getWallet,
  getPlatformEarnings,
  listTransactions,
  debitSpendable,
  creditWithdrawable,
  round2,
};
