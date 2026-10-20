const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const Video = require('../models/Video');
const WatchEvent = require('../models/WatchEvent');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// A player reports one event per video it finishes showing. The cap is
// generous enough for fast scrolling but stops a script from inflating
// retention numbers.
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados eventos, espera un momento' },
});

const watchRules = [
  body('videoId').isMongoId().withMessage('Video inválido'),
  // 24h ceiling: anything larger is a clock bug or a forged payload, not a
  // 15-second clip being rewatched.
  body('watchDuration').isFloat({ min: 0, max: 86_400 }).toFloat(),
  body('videoDuration').optional().isFloat({ min: 0, max: 86_400 }).toFloat(),
  body('replayed').optional().isBoolean().toBoolean(),
];

router.post(
  '/watch',
  auth,
  analyticsLimiter,
  watchRules,
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findById(req.body.videoId).select('duration creator');
    if (!video) throw new HttpError(404, 'Video no encontrado');

    // Trust the stored duration over the client-supplied one. A player that
    // reports a 1-second duration could otherwise claim a 100% completion.
    const videoDuration = video.duration || req.body.videoDuration || 0;
    if (videoDuration <= 0) {
      throw new HttpError(400, 'Duración del video desconocida');
    }

    const event = await WatchEvent.create({
      userId: req.user.userId,
      videoId: video._id,
      watchDuration: req.body.watchDuration,
      videoDuration,
      replayed: Boolean(req.body.replayed),
    });

    res.status(201).json({
      recorded: true,
      completionRate: event.completionRate,
      completed: event.completed,
    });
  })
);

module.exports = router;
