const express = require('express');
const { body, param, query } = require('express-validator');
const safetyService = require('../services/safetyService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

// Toda la seguridad exige sesión: bloquear y reportar son actos de una cuenta
// identificada. Un reporte anónimo no se puede seguir ni proteger de abuso.
router.use(auth);

// --- Bloqueo -------------------------------------------------------------

router.get(
  '/blocked',
  asyncHandler(async (req, res) => {
    res.json({ blocked: await safetyService.listBlocked(req.user.userId) });
  })
);

router.post(
  '/block/:userId',
  [param('userId').isMongoId().withMessage('Usuario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await safetyService.blockUser(req.user.userId, req.params.userId));
  })
);

router.delete(
  '/block/:userId',
  [param('userId').isMongoId().withMessage('Usuario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await safetyService.unblockUser(req.user.userId, req.params.userId));
  })
);

// --- Reportes ------------------------------------------------------------

// Los motivos son una lista cerrada: se valida aquí y también en el esquema,
// para que un cliente no pueda inventarse una categoría que la cola de
// moderación no sepa agrupar.
const REASONS = [
  'spam',
  'harassment',
  'hate',
  'violence',
  'nudity',
  'misinformation',
  'impersonation',
  'self_harm',
  'other',
];

router.post(
  '/reports',
  [
    body('targetType')
      .isIn(['video', 'user', 'post', 'comment', 'post_comment', 'message'])
      .withMessage('Tipo de reporte inválido'),
    body('targetId').isMongoId().withMessage('Contenido inválido'),
    body('reason').isIn(REASONS).withMessage('Motivo inválido'),
    body('details').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const report = await safetyService.createReport({
      reporterId: req.user.userId,
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      reason: req.body.reason,
      details: req.body.details || '',
    });
    res.status(201).json({ report });
  })
);

router.get(
  '/reports',
  [query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  asyncHandler(async (req, res) => {
    const reports = await safetyService.listMyReports(req.user.userId, {
      limit: req.query.limit,
    });
    res.json({ reports });
  })
);

router.delete(
  '/reports/:id',
  [param('id').isMongoId().withMessage('Reporte inválido')],
  validate,
  asyncHandler(async (req, res) => {
    res.json(
      await safetyService.withdrawReport({
        reporterId: req.user.userId,
        reportId: req.params.id,
      })
    );
  })
);

module.exports = router;
