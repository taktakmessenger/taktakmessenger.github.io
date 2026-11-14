// Endpoints del relé para el minado on-chain de TakCoin (TKC).
//
//   GET  /api/mining/config   → configuración pública (¿está configurado?, red,
//                               contrato, pesos, tope diario…).
//   GET  /api/mining/me       → minado pendiente y minado de hoy del usuario.
//   POST /api/mining/voucher  → firma un vale para cobrar el minado pendiente.
//   POST /api/mining/claimed  → registra que el vale se liquidó on-chain.
//
// Si falta el contrato o la clave del oráculo, todo responde 503: es mejor no
// ofrecer el minado que prometer un cobro que no se puede firmar.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { auth, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');
const miningService = require('../services/miningService');

const router = express.Router();

const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de cobro, espera un momento' },
});

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json(miningService.publicConfig());
  })
);

router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    const units = await miningService.unitsFor(req.user.userId);
    res.json({ configured: miningService.publicConfig().configured, units });
  })
);

router.post(
  '/voucher',
  auth,
  claimLimiter,
  [body('address').isEthereumAddress().withMessage('Dirección de wallet inválida')],
  validate,
  asyncHandler(async (req, res) => {
    if (!miningService.publicConfig().configured) {
      throw new HttpError(503, 'La minería on-chain no está configurada');
    }
    const voucher = await miningService.issueVoucher(req.user.userId, req.body.address);
    res.json(voucher);
  })
);

router.post(
  '/claimed',
  auth,
  [
    body('coins').isInt({ min: 0 }).toInt(),
    body('videos').optional().isInt({ min: 0 }).toInt(),
    body('txHash').optional().isString().isLength({ min: 66, max: 66 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await miningService.markClaimed(req.user.userId, {
      coins: req.body.coins,
      videos: req.body.videos,
      txHash: req.body.txHash,
    });
    res.json(result);
  })
);

// Quema de TKC del fondo (solo admin). Es la palanca deflacionaria: reduce la
// oferta neta. Va separada del minado porque es una decisión de tesorería, no
// una acción del usuario.
router.post(
  '/burn',
  auth,
  requireAdmin,
  [body('amount').isFloat({ gt: 0 }).toFloat()],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await miningService.burnFromPool(req.body.amount));
  })
);

module.exports = router;
