const express = require('express');
const { body, param, query } = require('express-validator');
const pokerEventService = require('../services/pokerEventService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

// Torneos de POKERTAK, vistos por el jugador. Crear y cerrar torneos es cosa del
// administrador (`/api/admin/poker-events`); aquí solo se listan, se ven y uno se
// inscribe. Todo requiere sesión: inscribirse mueve monedas del monedero.
const router = express.Router();

router.use(auth);

// Torneos abiertos a inscripción. Es lo que enseña la sala de juegos para saber
// qué hay programado y apuntarse.
router.get(
  '/events',
  [query('squad').optional().isString().trim().isLength({ max: 60 })],
  validate,
  asyncHandler(async (req, res) => {
    const events = await pokerEventService.listEvents({
      status: 'scheduled',
      squadSlug: req.query.squad,
      limit: 50,
    });
    res.json({ events });
  })
);

router.get(
  '/events/:id',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const event = await pokerEventService.getEvent(req.params.id);
    if (!event) throw new HttpError(404, 'Torneo no encontrado');
    res.json({ event });
  })
);

// Inscribirse: cobra la entrada en el servidor y guarda el asiento. El importe
// nunca viene del cliente; se lee del propio torneo.
router.post(
  '/events/:id/join',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const event = await pokerEventService.joinEvent({
      eventId: req.params.id,
      userId: req.user.userId,
      username: req.user.username,
    });
    res.status(201).json({ event: pokerEventService.publicEvent(event) });
  })
);

module.exports = router;
