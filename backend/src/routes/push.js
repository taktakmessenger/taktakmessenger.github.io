const express = require('express');
const { body } = require('express-validator');
const env = require('../config/env');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler } = require('../utils/http');
const pushService = require('../services/pushService');

const router = express.Router();

// ¿Se pueden enviar notificaciones en este despliegue? El frontend lo consulta
// antes de pedir permiso: pedir permiso para algo que no se va a poder usar
// quema el permiso del navegador (y en Safari iOS solo se puede pedir una vez,
// así que gastarlo en balde es caro).
router.get(
  '/config',
  auth,
  asyncHandler(async (req, res) => {
    res.json({
      available: pushService.isConfigured(),
      // La clave pública VAPID es pública por diseño: el navegador la necesita
      // para suscribirse. La privada nunca sale de aquí.
      publicKey: env.vapidPublicKey || null,
    });
  })
);

// Alta de un dispositivo. La suscripción la genera el navegador y solo sirve
// para él, pero se ata al usuario autenticado para saber a quién despertar.
router.post(
  '/subscribe',
  auth,
  [
    body('subscription.endpoint').isURL().withMessage('Endpoint inválido'),
    body('subscription.keys.p256dh').isString().notEmpty(),
    body('subscription.keys.auth').isString().notEmpty(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    await pushService.saveSubscription({
      userId: req.user.userId,
      subscription: req.body.subscription,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({ subscribed: true });
  })
);

// Baja del dispositivo actual. Se manda al cerrar sesión para que no siga
// sonando en un teléfono que ya no es de quien estaba conectado.
router.post(
  '/unsubscribe',
  auth,
  [body('endpoint').isURL().withMessage('Endpoint inválido')],
  validate,
  asyncHandler(async (req, res) => {
    await pushService.removeSubscription({
      userId: req.user.userId,
      endpoint: req.body.endpoint,
    });

    res.json({ subscribed: false });
  })
);

module.exports = router;
