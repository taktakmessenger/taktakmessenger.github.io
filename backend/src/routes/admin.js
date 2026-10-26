const express = require('express');
const { body, param, query } = require('express-validator');
const User = require('../models/User');
const Video = require('../models/Video');
const Transaction = require('../models/Transaction');
const NewsSource = require('../models/NewsSource');
const Report = require('../models/Report');
const walletService = require('../services/walletService');
const ageService = require('../services/ageService');
const newsService = require('../services/newsService');
const safetyService = require('../services/safetyService');
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
      // Revenue booked from the 40% platform cut on gifts.
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

// Adjust a user's balance (e.g. support credit or refund).
//
// Defaults to the promotional bucket: an admin credit is not revenue, so it
// must not become withdrawable Diamonds unless the admin says so explicitly.
// Every adjustment leaves a ledger entry, so a balance can never be minted
// without a matching, auditable record.
router.post(
  '/users/:id/credit',
  [
    param('id').isMongoId(),
    body('amount').isFloat().toFloat(),
    body('bucket').optional().isIn(['bonusC', 'ttcC', 'ttcR']),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const bucket = req.body.bucket || 'bonusC';
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $inc: { [`wallet.${bucket}`]: req.body.amount } },
      { new: true }
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    await Transaction.create({
      from: req.user.userId,
      to: user._id,
      amount: Math.abs(req.body.amount),
      type: 'bonus',
      ttcType: bucket === 'ttcR' ? 'ttcR' : 'ttcC',
      details: `Ajuste manual de admin (${bucket})`,
    });

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

// --- Cola de reportes ----------------------------------------------------
//
// Sin esto, un reporte era un agujero negro: el usuario lo enviaba y nadie lo
// veía. La cola muestra lo abierto primero, con el contenido reportado y quién
// lo publicó, que es lo que hace falta para decidir.

router.get(
  '/reports',
  [query('status').optional().isIn(['open', 'reviewing', 'actioned', 'dismissed'])],
  validate,
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : { status: 'open' };
    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('reporter', 'username')
      .lean();

    // El objeto reportado se resuelve aquí y no con un `populate`: el `ref` de
    // Mongoose no admite un valor dinámico, así que hay que buscarlo por tipo.
    const enriched = await Promise.all(
      reports.map(async (report) => {
        let target = null;
        try {
          const { doc, owner } = await safetyService.resolveTarget(
            report.targetType,
            report.targetId
          );
          const ownerUser = await User.findById(owner).select('username');
          target = {
            id: doc._id,
            owner: ownerUser ? { id: ownerUser._id, username: ownerUser.username } : null,
            // Un recorte del contenido hace la cola legible sin abrir nada.
            preview:
              doc.title ||
              doc.text ||
              doc.username ||
              (doc.attachment?.name ? `Adjunto: ${doc.attachment.name}` : null),
          };
        } catch {
          // El contenido pudo borrarse entre el reporte y la revisión. El
          // reporte se sigue mostrando, marcado como sin objeto.
          target = null;
        }
        return {
          id: report._id,
          targetType: report.targetType,
          targetId: report.targetId,
          reason: report.reason,
          details: report.details,
          status: report.status,
          reporter: report.reporter
            ? { id: report.reporter._id, username: report.reporter.username }
            : null,
          target,
          createdAt: report.createdAt,
        };
      })
    );

    res.json({ reports: enriched });
  })
);

// Decisión sobre un reporte. `actioned` implica que se tomó una medida sobre el
// contenido; `dismissed`, que no procedía. La nota es para el siguiente
// moderador que lo mire.
router.patch(
  '/reports/:id',
  [
    param('id').isMongoId(),
    body('status').isIn(['open', 'reviewing', 'actioned', 'dismissed']),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status: req.body.status,
        resolutionNote: req.body.note || '',
        reviewedBy: req.user.userId,
        reviewedAt: new Date(),
      },
      { new: true }
    );
    if (!report) throw new HttpError(404, 'Reporte no encontrado');
    res.json({ report });
  })
);

module.exports = router;
