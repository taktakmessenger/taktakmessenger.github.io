const express = require('express');
const { query, body, param } = require('express-validator');
const feedService = require('../services/feedService');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

// Anonymous visitors get the generic popularity feed; a logged-in viewer gets
// theirs personalised from watch history.
router.get(
  '/for-you',
  optionalAuth,
  [
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('page').optional().isInt({ min: 1, max: 500 }),
    query('exclude').optional().isString(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const exclude = (req.query.exclude || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const videos = await feedService.getForYouFeed(req.user?.userId, {
      limit: req.query.limit,
      page: req.query.page,
      excludeVideoIds: exclude,
    });

    res.json({ videos, page: Number(req.query.page) || 1 });
  })
);

// Exposed so the client can show "why am I seeing this".
router.get(
  '/interests',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json({ tags: await feedService.getPreferredTags(req.user?.userId) });
  })
);

// Negative signals. Both are idempotent: hiding something twice is not an
// error, and the client may retry safely.
router.post(
  '/hide-creator',
  auth,
  [body('creatorId').isMongoId().withMessage('Creador inválido')],
  validate,
  asyncHandler(async (req, res) => {
    await User.updateOne(
      { _id: req.user.userId },
      { $addToSet: { 'feedPreferences.hiddenCreators': req.body.creatorId } }
    );
    res.json({ hidden: true });
  })
);

router.delete(
  '/hide-creator/:creatorId',
  auth,
  [param('creatorId').isMongoId().withMessage('Creador inválido')],
  validate,
  asyncHandler(async (req, res) => {
    await User.updateOne(
      { _id: req.user.userId },
      { $pull: { 'feedPreferences.hiddenCreators': req.params.creatorId } }
    );
    res.json({ hidden: false });
  })
);

router.post(
  '/hide-tag',
  auth,
  [body('tag').trim().notEmpty().withMessage('Etiqueta requerida')],
  validate,
  asyncHandler(async (req, res) => {
    await User.updateOne(
      { _id: req.user.userId },
      { $addToSet: { 'feedPreferences.hiddenTags': req.body.tag } }
    );
    res.json({ hidden: true });
  })
);

module.exports = router;
