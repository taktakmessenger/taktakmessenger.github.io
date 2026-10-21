const express = require('express');
const { body, param, query } = require('express-validator');
const User = require('../models/User');
const Video = require('../models/Video');
const Transaction = require('../models/Transaction');
const NewsSource = require('../models/NewsSource');
const walletService = require('../services/walletService');
const ageService = require('../services/ageService');
const newsService = require('../services/newsService');
const { auth, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Every route below requires a valid token *and* an admin role.
router.use(auth, requireAdmin);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [users, videos, pendingVideos, transactions, earnings] = await Promise.all([
      User.countDocuments(),
      Video.countDocuments(),
      Video.countDocuments({ moderationStatus: 'pending' }),
      Transaction.countDocuments(),
      walletService.getPlatformEarnings(),
    ]);
    res.json({
      users,
      videos,
      pendingVideos,
      transactions,
      // Revenue booked from the 25% platform cut on gifts.
      platformEarnings: earnings.total,
      giftsProcessed: earnings.gifts,
    });
  })
);

router.get(
  '/users',
  [query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  asyncHandler(async (req, res) => {
    const users = await User.find()
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 50);
    res.json({ users });
  })
);

// Moderation queue + decision.
router.get(
  '/videos',
  [query('status').optional().isIn(['pending', 'approved', 'rejected'])],
  validate,
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { moderationStatus: req.query.status } : {};
    const videos = await Video.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('creator', 'username');
    res.json({ videos });
  })
);

router.patch(
  '/videos/:id/moderate',
  [
    param('id').isMongoId(),
    body('status').isIn(['approved', 'rejected']).withMessage('Estado inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      {
        moderationStatus: req.body.status,
        moderatedAt: new Date(),
        moderatedBy: req.user.userId,
      },
      { new: true }
    );
    if (!video) throw new HttpError(404, 'Video no encontrado');
    res.json({ video });
  })
);

// Adjust a user's spendable balance (e.g. support credit or refund).
router.post(
  '/users/:id/credit',
  [param('id').isMongoId(), body('amount').isFloat().toFloat(), body('bucket').optional().isIn(['ttcC', 'ttcR'])],
  validate,
  asyncHandler(async (req, res) => {
    const bucket = req.body.bucket === 'ttcR' ? 'ttcR' : 'ttcC';
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $inc: { [`wallet.${bucket}`]: req.body.amount } },
      { new: true }
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ user });
  })
);

// --- Age verification -------------------------------------------------------

// Accounts awaiting an age-verification decision, for manual review.
router.get(
  '/age-verifications',
  [query('status').optional().isIn(['unverified', 'pending', 'verified', 'rejected'])],
  validate,
  asyncHandler(async (req, res) => {
    const status = req.query.status || 'pending';
    const users = await User.find({ 'ageVerification.status': status })
      .select('username email ageVerification createdAt')
      .sort({ updatedAt: -1 })
      .limit(100);
    res.json({ users });
  })
);

// Override an age-verification verdict. `method` is forced to 'admin' by the
// service so a manual grant is always attributable.
router.patch(
  '/age-verifications/:id',
  [
    param('id').isMongoId(),
    body('status').isIn(['verified', 'rejected', 'unverified']).withMessage('Estado inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await ageService.setVerificationByAdmin(
      req.params.id,
      req.body.status,
      req.user.userId
    );
    res.json(result);
  })
);

// --- News sources and badges ------------------------------------------------

router.get(
  '/news-sources',
  [query('status').optional().isIn(['pending', 'verified', 'revoked'])],
  validate,
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};
    const sources = await NewsSource.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ sources });
  })
);

// Approve, revoke or re-open a source. Revoking also strips the badge from
// content already published under it (see newsService).
router.patch(
  '/news-sources/:id',
  [
    param('id').isMongoId(),
    body('status').isIn(['pending', 'verified', 'revoked']).withMessage('Estado inválido'),
    body('domains').optional().isArray({ max: 10 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.domains) {
      await NewsSource.updateOne(
        { _id: req.params.id },
        { $set: { domains: req.body.domains.map((d) => String(d).trim().toLowerCase()) } }
      );
    }
    const source = await newsService.setSourceStatus(
      req.params.id,
      req.body.status,
      req.user.userId
    );
    res.json({ source });
  })
);

// Videos whose creator claimed a news source, awaiting the badge decision.
router.get(
  '/news-claims',
  asyncHandler(async (req, res) => {
    const videos = await Video.find({ newsSource: { $ne: null } })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('creator', 'username')
      .populate('newsSource', 'name status domains');
    res.json({ videos });
  })
);

// Grant the news badge. The claim is re-validated from scratch: the source may
// have been revoked, or the link edited, since upload.
router.post(
  '/news-claims/:id/approve',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const video = await newsService.grantBadge(req.params.id, req.user.userId);
    res.json({ video });
  })
);

router.post(
  '/news-claims/:id/revoke',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const video = await newsService.revokeBadge(req.params.id);
    res.json({ video });
  })
);

module.exports = router;
