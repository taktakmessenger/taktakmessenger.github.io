const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler } = require('../utils/http');
const env = require('../config/env');

const router = express.Router();

// Money-moving endpoints get a tighter limit than general reads.
const moneyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones, espera un momento' },
});

router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    res.json(await walletService.getWallet(req.user.userId));
  })
);

router.get(
  '/transactions',
  auth,
  [query('limit').optional().isInt({ min: 1, max: 200 })],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await walletService.listTransactions(req.user.userId, req.query.limit));
  })
);

router.post(
  '/gift',
  auth,
  moneyLimiter,
  [
    body('recipientId').isMongoId().withMessage('Receptor inválido'),
    body('amount').optional().isFloat({ gt: 0 }).withMessage('Monto inválido').toFloat(),
    body('giftCost').optional().isFloat({ gt: 0 }).withMessage('Monto inválido').toFloat(),
    body('giftName').optional().trim().isLength({ max: 40 }),
    body('giftId').optional().isMongoId().withMessage('Regalo inválido'),
    body('videoId').optional().isMongoId(),
    // Either a catalogue gift (`giftId`) or a free amount, never both. With a
    // giftId the price is read from the catalogue, not from the request.
    body().custom((value) => {
      const hasAmount = value.amount !== undefined && value.amount !== '';
      const hasCost = value.giftCost !== undefined && value.giftCost !== '';
      const hasGiftId = value.giftId !== undefined && value.giftId !== '';
      if (hasGiftId && (hasAmount || hasCost)) {
        throw new Error('Con giftId no envíes amount ni giftCost');
      }
      if (!hasGiftId && !hasAmount && !hasCost) {
        throw new Error('Falta el monto del regalo');
      }
      if (hasAmount && hasCost) throw new Error('Envía solo amount o giftCost');
      return true;
    }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const amount = req.body.amount ?? req.body.giftCost;
    const result = await walletService.sendGift({
      senderId: req.user.userId,
      recipientId: req.body.recipientId,
      amount,
      giftId: req.body.giftId,
      videoId: req.body.videoId,
      giftName: req.body.giftName,
    });

    // El aviso se manda después de que el dinero esté movido y con el resultado
    // ya calculado: el importe que se enseña es el que de verdad se cobró, no
    // el que el cliente pidió. Si esto falla, el regalo sigue hecho.
    await notificationService.notify({
      recipientId: req.body.recipientId,
      actorId: req.user.userId,
      type: 'gift',
      video: req.body.videoId || null,
      amount: result.amount,
      giftName: result.giftName || null,
    });

    res.json({
      message: result.giftName
        ? `¡Enviaste ${result.giftName}! El creador recibió el ${Math.round(
            env.creatorShare * 100
          )}% de su valor.`
        : 'Regalo enviado exitosamente',
      transaction: result,
      remainingCoins: result.remainingCoins,
    });
  })
);

router.get(
  '/monetization',
  auth,
  asyncHandler(async (req, res) => {
    const wallet = await walletService.getWallet(req.user.userId);

    res.json({
      // Open monetization: there is no follower or view threshold. This is the
      // deliberate contrast with platforms that gate payouts behind 10k
      // followers / 100k views.
      eligible: true,
      requirements: {
        minFollowers: 0,
        minViews: 0,
        minVideos: 0,
      },
      creatorShare: env.creatorShare,
      platformShare: env.platformShare,
      diamondsEarned: wallet.diamonds,
      withdrawable: wallet.diamonds > 0,
      message:
        'Monetización abierta: puedes recibir regalos y acumular Diamantes desde tu primer video.',
    });
  })
);

router.post(
  '/withdraw',
  auth,
  moneyLimiter,
  [
    body('amount').isFloat({ gt: 0 }).withMessage('Monto inválido').toFloat(),
    body('method').trim().notEmpty().withMessage('Método de retiro requerido'),
    body('details').optional().trim().isLength({ max: 200 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await walletService.requestWithdrawal({
      userId: req.user.userId,
      amount: req.body.amount,
      method: req.body.method,
      details: req.body.details,
    });
    res.json({ message: 'Solicitud de retiro procesada', ...result });
  })
);

module.exports = router;
