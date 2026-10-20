const express = require('express');
const { body } = require('express-validator');
const User = require('../models/User');
const Video = require('../models/Video');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ user });
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
