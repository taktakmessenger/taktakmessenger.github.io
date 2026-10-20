const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones' },
});

// Constant-time comparison so a wrong secret cannot be recovered by timing.
function secretMatches(provided) {
  if (!env.paymentWebhookSecret || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(env.paymentWebhookSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Payment provider webhook: credits TTC-C after a real purchase.
 *
 * Two properties the original prototype lacked and that matter more than
 * anything else here:
 *
 *  - The price comes from `env.coinPackages`, keyed by package id. A request
 *    cannot ask for 7000 coins while paying for the 70-coin pack.
 *  - `externalId` is the provider's event id and is uniquely indexed, so a
 *    retried webhook credits the account exactly once.
 */
router.post(
  '/webhook',
  webhookLimiter,
  express.json({ limit: '100kb' }),
  asyncHandler(async (req, res) => {
    const { event, userId, packageId, externalId, amountPaid, currency, signature } = req.body;

    // Closed by default: without a configured secret the endpoint refuses
    // everything rather than trusting an unauthenticated POST.
    if (!env.paymentWebhookSecret) {
      throw new HttpError(503, 'Pagos no configurados');
    }
    if (!secretMatches(signature || req.get('x-webhook-signature'))) {
      throw new HttpError(401, 'Firma inválida');
    }

    if (event !== 'checkout.session.completed' && event !== 'payment.succeeded') {
      throw new HttpError(400, 'Evento no soportado');
    }
    if (!externalId) {
      throw new HttpError(400, 'Falta el identificador del evento');
    }

    // Idempotency: a duplicate event id means the provider retried a delivery
    // we already processed.
    const existing = await Transaction.findOne({ externalId });
    if (existing) {
      return res.json({ received: true, duplicate: true });
    }

    const pkg = env.coinPackages.find((p) => p.id === packageId);
    if (!pkg) throw new HttpError(400, 'Paquete de monedas desconocido');

    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { 'wallet.ttcC': pkg.coins } },
      { new: true }
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    try {
      await Transaction.create({
        from: user._id,
        amount: pkg.coins,
        type: 'purchase',
        ttcType: 'ttcC',
        packageId: pkg.id,
        externalId,
        amountPaid: amountPaid ?? pkg.priceUsd,
        currency: currency || 'USD',
        status: 'completed',
        details: `Compra de ${pkg.coins} TTC-C (paquete ${pkg.id})`,
      });
    } catch (err) {
      // A concurrent delivery of the same event lost the unique-index race.
      // Undo this credit so the buyer is not paid twice.
      if (err.code === 11000) {
        await User.updateOne({ _id: user._id }, { $inc: { 'wallet.ttcC': -pkg.coins } });
        return res.json({ received: true, duplicate: true });
      }
      throw err;
    }

    res.json({ received: true, coins: pkg.coins, balance: user.wallet.ttcC });
  })
);

// Packages are published so the client can render the store without hardcoding
// prices. The coin amount and price are authoritative server-side.
router.get(
  '/packages',
  asyncHandler(async (_req, res) => {
    res.json({ packages: env.coinPackages, currency: 'USD' });
  })
);

module.exports = router;
