const express = require('express');
const { param, query } = require('express-validator');
const notificationService = require('../services/notificationService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

// Todas las rutas son privadas: los avisos de una cuenta no los ve nadie más.
// El filtro por `recipient` va en el servicio, no solo aquí, para que ninguna
// consulta pueda leer los de otro pasando un id.

router.get(
  '/',
  auth,
  [
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('cursor').optional().isISO8601().withMessage('Cursor inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await notificationService.listForUser({
      userId: req.user.userId,
      cursor: req.query.cursor,
      limit: Number(req.query.limit) || undefined,
    });
    res.json(result);
  })
);

// Solo el contador. La campana lo pide al arrancar sin traerse la lista entera.
router.get(
  '/unread-count',
  auth,
  asyncHandler(async (req, res) => {
    res.json({ unread: await notificationService.unreadCount(req.user.userId) });
  })
);

router.post(
  '/read-all',
  auth,
  asyncHandler(async (req, res) => {
    res.json(await notificationService.markAllRead(req.user.userId));
  })
);

router.post(
  '/:id/read',
  auth,
  [param('id').isMongoId().withMessage('Aviso inválido')],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await notificationService.markRead({ userId: req.user.userId, id: req.params.id }));
  })
);

module.exports = router;
