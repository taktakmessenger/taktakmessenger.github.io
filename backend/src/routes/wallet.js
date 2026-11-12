const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const walletService = require('../services/walletService');
const notificationService = require('../services/notificationService');
const referralService = require('../services/referralService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');
const env = require('../config/env');

const router = express.Router();

// Los retiros van SOLO a billetera cripto (USDT). Una sola vía, sin cuentas de
// terceros ni comisiones de intermediario.
const WITHDRAW_METHODS = ['crypto'];
const withdrawMethodAllowed = (method) => method === 'crypto';

// Una dirección EVM (0x + 40 hex) es lo único que se acepta como destino. Validar
// aquí evita guardar una dirección mal escrita que luego perdería el dinero.
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

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
      remainingBonusCoins: result.remainingBonusCoins,
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

router.get(
  '/referral',
  auth,
  asyncHandler(async (req, res) => {
    // El código se crea aquí, en la primera visita a la pantalla: así solo se
    // gasta un código en las cuentas que de verdad invitan a alguien.
    await referralService.ensureCode(req.user.userId);
    res.json(await referralService.stats(req.user.userId));
  })
);

router.post(
  '/withdraw',
  auth,
  moneyLimiter,
  [
    // El importe se normaliza a cadena decimal y se valida con BigInt en el
    // servicio, no con `Number`, para que no lo decida el redondeo en coma
    // flotante. Se acepta un número de un cliente antiguo (se redondea al
    // céntimo) y una cadena del cliente nuevo (se valida tal cual).
    body('amount')
      .exists()
      .withMessage('Monto inválido')
      .bail()
      .customSanitizer((v) => (typeof v === 'number' ? v.toFixed(2) : v))
      .isString()
      .withMessage('Monto inválido')
      .bail()
      .matches(/^\d+(?:\.\d{1,2})?$/)
      .withMessage('Monto inválido: usa como máximo 2 decimales'),
    body('method').trim().isIn(WITHDRAW_METHODS).withMessage('Método no admitido'),
    body('details')
      .trim()
      .notEmpty()
      .withMessage('Indica tu dirección de billetera')
      .bail()
      .matches(EVM_ADDRESS)
      .withMessage('Dirección de billetera inválida (debe empezar por 0x y tener 40 caracteres)')
      .isLength({ max: 200 }),
    // Clave de idempotencia del cliente: opcional, pero si viene se acota.
    body('idempotencyKey')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 8, max: 100 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Clave de idempotencia inválida'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (!withdrawMethodAllowed(req.body.method)) {
      throw new HttpError(400, 'Método de retiro no admitido');
    }
    const result = await walletService.requestWithdrawal({
      userId: req.user.userId,
      amount: req.body.amount,
      method: req.body.method,
      details: req.body.details,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.json({ message: 'Solicitud de retiro procesada', ...result });
  })
);

// Parámetros que la pantalla de retiro necesita para validar antes de enviar:
// mínimo, tope diario y tasa de conversión a dólares. Van aquí y no en el
// cliente para que un cambio de configuración no deje la UI mintiendo.
router.get(
  '/withdraw/config',
  auth,
  asyncHandler(async (_req, res) => {
    res.json({
      min: env.withdrawals.min,
      dailyCap: env.withdrawals.dailyCap,
      usdRate: env.withdrawals.usdRate,
      // Red obligatoria del retiro, para que la UI la muestre en grande: enviar
      // USDT por otra red pierde el dinero.
      network: env.crypto.network,
      asset: 'USDT',
      // Solo los métodos que hoy se pueden usar (hoy, solo cripto).
      methods: WITHDRAW_METHODS.filter(withdrawMethodAllowed),
    });
  })
);

module.exports = router;
