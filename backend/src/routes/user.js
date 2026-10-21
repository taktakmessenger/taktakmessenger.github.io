const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Video = require('../models/Video');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');
const phoneService = require('../services/phoneService');
const notificationService = require('../services/notificationService');
const env = require('../config/env');

const router = express.Router();

// Buscar por teléfono permite comprobar si un número está registrado, así que
// lleva un límite propio y más estrecho que el general. Se salta en tests,
// donde una suite legítimamente hace más peticiones que un cliente real.
const lookupLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiadas búsquedas, espera un momento' },
    });

router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ user });
  })
);

// Resuelve un número de teléfono a la cuenta que lo tiene, para poder llamarla
// desde el marcador. Va autenticado y limitado: sin sesión, cualquiera podría
// recorrer el espacio de números y averiguar quién está en TAK TAK. Solo
// devuelve la identidad pública, nunca el teléfono ni el email.
router.post(
  '/lookup-phone',
  auth,
  lookupLimiter,
  [body('phone').trim().notEmpty().withMessage('Número de teléfono requerido')],
  validate,
  asyncHandler(async (req, res) => {
    // `normalizePhone` lanza 400 con un mensaje que nombra el país cuando el
    // número no es válido, así que el marcador puede explicar qué corregir.
    const e164 = phoneService.normalizePhone(req.body.phone, req.body.country);

    const user = await User.findOne({ phone: e164 }).select(
      'username profile.displayName profile.avatar'
    );

    // Mismo mensaje para "no existe" y "es tu propio número": si diferenciara,
    // el endpoint serviría para comprobar qué números están registrados.
    if (!user || String(user._id) === String(req.user.userId)) {
      throw new HttpError(404, 'No hay ninguna cuenta de TAK TAK con ese número');
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        displayName: user.profile?.displayName,
        avatar: user.profile?.avatar,
      },
    });
  })
);

router.patch(
  '/me',
  auth,
  [
    body('displayName').optional().trim().isLength({ max: 50 }),
    body('bio').optional().trim().isLength({ max: 300 }),
    body('avatar').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { displayName, bio, avatar } = req.body;
    const update = {};
    if (displayName !== undefined) update['profile.displayName'] = displayName;
    if (bio !== undefined) update['profile.bio'] = bio;
    if (avatar !== undefined) update['profile.avatar'] = avatar;

    const user = await User.findByIdAndUpdate(req.user.userId, update, {
      new: true,
      runValidators: true,
    });
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ user });
  })
);

router.get(
  '/:username',
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ username: req.params.username }).select(
      'username profile stats createdAt'
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    const videos = await Video.find({
      creator: user._id,
      moderationStatus: 'approved',
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ user, videos });
  })
);

// Follow / unfollow. `$addToSet`/`$pull` keep the arrays idempotent, so a
// double-click cannot create duplicate edges.
router.post(
  '/:username/follow',
  auth,
  asyncHandler(async (req, res) => {
    const target = await User.findOne({ username: req.params.username });
    if (!target) throw new HttpError(404, 'Usuario no encontrado');
    if (target._id.toString() === req.user.userId) {
      throw new HttpError(400, 'No puedes seguirte a ti mismo');
    }

    await User.updateOne(
      { _id: req.user.userId },
      { $addToSet: { 'profile.following': target._id } }
    );
    await User.updateOne(
      { _id: target._id },
      { $addToSet: { 'profile.followers': req.user.userId } }
    );

    await notificationService.notify({
      recipientId: target._id,
      actorId: req.user.userId,
      type: 'follow',
    });

    res.json({ following: true });
  })
);

router.delete(
  '/:username/follow',
  auth,
  asyncHandler(async (req, res) => {
    const target = await User.findOne({ username: req.params.username });
    if (!target) throw new HttpError(404, 'Usuario no encontrado');

    await User.updateOne(
      { _id: req.user.userId },
      { $pull: { 'profile.following': target._id } }
    );
    await User.updateOne(
      { _id: target._id },
      { $pull: { 'profile.followers': req.user.userId } }
    );

    res.json({ following: false });
  })
);

module.exports = router;
