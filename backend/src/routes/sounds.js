const express = require('express');
const mongoose = require('mongoose');
const { body, query } = require('express-validator');
const Sound = require('../models/Sound');
const Video = require('../models/Video');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

router.get(
  '/',
  [query('limit').optional().isInt({ min: 1, max: 50 })],
  validate,
  asyncHandler(async (req, res) => {
    const sounds = await Sound.find()
      .sort({ usageCount: -1, createdAt: -1 })
      .limit(Number(req.query.limit) || 20)
      .populate('originalVideo', 'title creator');
    res.json({ sounds });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Guard before the query: an invalid id would otherwise throw a cast error
    // and surface as a 500 instead of a clean 404.
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new HttpError(404, 'Sonido no encontrado');
    }

    const sound = await Sound.findById(req.params.id).populate(
      'originalVideo',
      'title creator'
    );
    if (!sound) throw new HttpError(404, 'Sonido no encontrado');

    // The videos that used this sound are how a trend becomes visible.
    const videos = await Video.find({
      sound: sound._id,
      moderationStatus: 'approved',
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('creator', 'username profile.displayName');

    res.json({ sound, videos });
  })
);

// Clip a sound from a video you own, so others can build on your trend.
router.post(
  '/',
  auth,
  [
    body('title').trim().notEmpty().withMessage('Título requerido').isLength({ max: 100 }),
    body('audioUrl').trim().isURL().withMessage('URL de audio inválida'),
    body('artist').optional().trim().isLength({ max: 60 }),
    body('duration').optional().isFloat({ min: 0 }),
    body('originalVideo').optional().isMongoId(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.originalVideo) {
      const video = await Video.findById(req.body.originalVideo);
      if (!video) throw new HttpError(404, 'Video original no encontrado');
      if (video.creator.toString() !== req.user.userId && req.user.role !== 'admin') {
        throw new HttpError(403, 'Solo el creador puede extraer el sonido de su video');
      }
    }

    const sound = await Sound.create({ ...req.body, createdBy: req.user.userId });
    res.status(201).json({ sound });
  })
);

module.exports = router;
