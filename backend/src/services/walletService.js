const mongoose = require('mongoose');
const User = require('../models/User');
const Video = require('../models/Video');
const Gift = require('../models/Gift');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const db = require('../config/db');
const { HttpError } = require('../utils/http');

/**
 * Debit `amount` from a user's TTC-C balance only if the balance is sufficient.
 *
 * The prototype read the balance, checked it in JS, then saved the whole
 * document. Two concurrent gifts could both pass the check and drive the
 * balance negative. A single conditional update makes the check-and-debit
 * atomic at the database level: if no document matches, the funds were not
 * available.
 */
async function debitSpendable(userId, amount) {
  return User.findOneAndUpdate(
    { _id: userId, 'wallet.ttcC': { $gte: amount } },
    { $inc: { 'wallet.ttcC': -amount } },
    { new: true }
  );
}

async function creditWithdrawable(userId, amount, session) {
  return User.findOneAndUpdate(
    { _id: userId },
    { $inc: { 'wallet.ttcR': amount, 'stats.totalGiftsReceived': 1 } },
    { new: true, session }
  );
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
 * Send a gift of TTC-C from one user to another.
 *
 * The debit happens first and is the guard: if the sender cannot cover the
 * amount the whole operation aborts before any credit is applied.
 *
 * Revenue split: the creator keeps 75% as withdrawable TTC-R and the platform
 * takes 25%. The platform share is booked as a ledger entry so the house
 * earnings are auditable instead of vanishing from the balance sheet.
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

  const sender = await debitSpendable(senderId, amount);
  if (!sender) throw new HttpError(400, 'TTC-C insuficientes');

  // The creator share is floored to whole TTC-R (diamonds are integers); the
  // remainder goes to the platform so the two sides always sum to `amount`.
  const creatorAmount = Math.floor(amount * env.creatorShare);
  const platformAmount = round2(amount - creatorAmount);

  const ledgerEntry = {
    from: senderId,
    to: recipientId,
    amount,
    type: 'gift',
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
    type: 'platform',
    ttcType: 'ttcC',
    creatorAmount: 0,
    platformAmount,
    giftName,
    videoId,
  };

  await applyCreditAndLedger(
    recipientId,
    creatorAmount,
    [ledgerEntry, platformEntry],
    { refund: { userId: senderId, ttcC: amount } }
  );

  // Engagement counters are best-effort: a failure here must not undo a gift
  // that has already been settled.
  if (videoId) {
    await Video.updateOne({ _id: videoId }, { $inc: { gifts: 1, ttcEarned: creatorAmount } });
  }

  return { amount, creatorAmount, platformAmount, giftName, remainingCoins: sender.wallet.ttcC };
}

// Applies the recipient credit and the ledger entries together. On a replica set
// this is a real transaction; on standalone MongoDB the writes are sequenced
// with a compensating rollback if a later one fails.
async function applyCreditAndLedger(recipientId, creatorAmount, ledgerEntries, { refund } = {}) {
  const entries = Array.isArray(ledgerEntries) ? ledgerEntries : [ledgerEntries];

  if (await db.supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // The credit must join the session too, otherwise it commits even when
        // the ledger write fails and the creator is paid with no matching entry.
        await creditWithdrawable(recipientId, creatorAmount, session);
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
    await creditWithdrawable(recipientId, creatorAmount);
    await Transaction.create(entries);
  } catch (err) {
    if (refund) await compensate(refund);
    throw err;
  }
}

// Restores the sender's balance if a later step in the transfer failed.
async function compensate({ userId, ttcC }) {
  await User.updateOne({ _id: userId }, { $inc: { 'wallet.ttcC': ttcC } });
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
    diamonds: user.wallet.ttcR,
    ttcC: user.wallet.ttcC,
    ttcR: user.wallet.ttcR,
    totalTTC: round2(user.wallet.ttcC + user.wallet.ttcR),
    stats: user.stats,
  };
}

// Total TTC the platform has earned from the 25% gift cut.
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
