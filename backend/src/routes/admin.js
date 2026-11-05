const express = require('express');
const { body, param, query } = require('express-validator');
const User = require('../models/User');
const Video = require('../models/Video');
const Transaction = require('../models/Transaction');
const NewsSource = require('../models/NewsSource');
const Report = require('../models/Report');
const walletService = require('../services/walletService');
const phoneService = require('../services/phoneService');
const ageService = require('../services/ageService');
const newsService = require('../services/newsService');
const safetyService = require('../services/safetyService');
const manualPaymentService = require('../services/manualPaymentService');
const asistakService = require('../services/asistakService');
const pokerEventService = require('../services/pokerEventService');
const adminAssistant = require('../services/adminAssistant');
const assistantThreadService = require('../services/assistantThreadService');
const { auth, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');
const env = require('../config/env');

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
      // Revenue booked from the platform cut on gifts. The percentage comes from
      // config so the label can never drift from the real split.
      platformEarnings: earnings.total,
      giftsProcessed: earnings.gifts,
      platformShare: env.platformShare,
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

/* ------------------------------------------------------------------ */
/* Asistente del administrador                                         */
/* ------------------------------------------------------------------ */
//
// Chat con el que el dueño pide tareas en lenguaje natural. Solo responde a
// administradores (todo este router ya pasa por `requireAdmin`). El historial
// vive en la base por administrador (AssistantThread), así la conversación
// sobrevive a recargas y cambios de dispositivo; el cliente solo manda el turno
// nuevo.

router.get(
  '/assistant',
  asyncHandler(async (req, res) => {
    const messages = await assistantThreadService.load(req.user.userId);
    res.json({ messages });
  })
);

router.post(
  '/assistant',
  [
    body('message').isString().trim().isLength({ min: 1, max: 4000 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (!adminAssistant.isConfigured()) {
      return res.status(503).json({
        error: 'El asistente no está configurado (falta ASSISTANT_API_KEY).',
      });
    }
    try {
      const result = await adminAssistant.chat({
        message: req.body.message,
        adminId: req.user.userId,
      });
      return res.json(result);
    } catch (err) {
      // La cuota del proveedor (429) es lo que más ve el administrador. En vez
      // de volcar el JSON del proveedor, se devuelve una frase útil y un 503
      // para que el cliente la muestre tal cual.
      if (err.status === 429) {
        return res.status(503).json({
          error:
            'GLENIS IA está saturada en este momento (límite del proveedor). Espera unos segundos y vuelve a preguntar.',
        });
      }
      throw err;
    }
  })
);

// Borra el hilo del administrador. El botón "Limpiar" del panel lo usa para
// empezar de cero; sin esto, limpiar solo vaciaba la pantalla y el asistente
// seguía recordando todo.
router.delete(
  '/assistant',
  asyncHandler(async (req, res) => {
    await assistantThreadService.clear(req.user.userId);
    res.json({ cleared: true });
  })
);

/* ------------------------------------------------------------------ */
/* Cartera del administrador                                           */
/* ------------------------------------------------------------------ */
//
// Convertir Monedas en Diamantes retirables es una facultad exclusiva del
// administrador: es la única vía por la que monedas sin reparto de regalos se
// vuelven saldo canjeable. Todo el router ya pasa por `requireAdmin`, así que
// ninguna cuenta normal puede llegar aquí.

router.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    res.json({
      wallet: await walletService.getWallet(req.user.userId),
      rate: env.coinToDiamondRate,
    });
  })
);

router.post(
  '/wallet/convert',
  [
    body('coins').isFloat({ gt: 0 }).withMessage('Cantidad inválida').toFloat(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await walletService.convertCoinsToDiamonds({
      userId: req.user.userId,
      coins: req.body.coins,
      rate: env.coinToDiamondRate,
    });
    res.json({
      message: `Convertiste ${result.coins} Monedas en ${result.diamonds} Diamantes`,
      ...result,
    });
  })
);

// Suspensiones de Asistak. El administrador puede suspender a mano a alguien
// (por ejemplo, tras un reporte) y levantar la suspensión antes de que caduque.
router.post(
  '/users/:id/suspend',
  [
    param('id').isMongoId(),
    body('days').optional().isInt({ min: 1, max: 365 }),
    body('reason').optional().trim().isLength({ max: 300 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await asistakService.suspendUser({
      userId: req.params.id,
      days: req.body.days || 3,
      reason: req.body.reason || '',
      by: 'admin',
    });
    if (!result) throw new HttpError(404, 'Usuario no encontrado');
    res.json(result);
  })
);

router.delete(
  '/users/:id/suspend',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    await asistakService.liftSuspension(req.params.id);
    res.json({ lifted: true });
  })
);

// Vincula un teléfono a una cuenta sin pasar por el SMS.
//
// El flujo normal (`/auth/phone/link/*`) exige un código que llega por SMS, y
// en un despliegue sin proveedor de SMS ese código nunca sale: la persona se
// queda en la pantalla del código esperando un mensaje que no llega. Como el
// administrador ya conoce al usuario y responde de la vinculación, se le da una
// vía directa. Marca el número como verificado porque es una acción deliberada
// del dueño de la app, no una autoverificación del usuario.
router.post(
  '/users/:id/phone',
  [
    param('id').isMongoId(),
    body('phone').trim().notEmpty().withMessage('Número de teléfono requerido'),
    body('country').optional().trim().isLength({ min: 2, max: 2 }),
    body('verified').optional().isBoolean().toBoolean(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const phone = phoneService.normalizePhone(req.body.phone, req.body.country);

    const user = await User.findById(req.params.id).select('username phone');
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    // Un número solo puede estar en una cuenta. Se comprueba antes de guardar
    // para dar un mensaje claro en vez del error de índice único.
    const owner = await User.findOne({ phone }).select('_id username');
    if (owner && String(owner._id) !== String(user._id)) {
      throw new HttpError(409, `Ese número ya está vinculado a @${owner.username}`);
    }

    user.phone = phone;
    user.phoneVerified = req.body.verified !== false;
    try {
      await user.save();
    } catch (err) {
      if (err.code === 11000) {
        throw new HttpError(409, 'Ese número ya está vinculado a otra cuenta');
      }
      throw err;
    }

    res.json({
      linked: true,
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
      },
    });
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

// --- Cobro manual: cola de revisión ---------------------------------------
//
// El administrador ve las órdenes pendientes, comprueba el ingreso por fuera y
// aprueba. Aprobar acredita las monedas de verdad (vía `creditPurchase`), así
// que es la única acción con consecuencia económica.

router.get(
  '/manual-orders',
  [
    query('status').optional().isIn(['pending', 'approved', 'rejected']),
    query('method').optional().isString().trim().isLength({ max: 40 }),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const orders = await manualPaymentService.listOrders({
      status: req.query.status,
      method: req.query.method,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ orders });
  })
);

// Totales de venta y quiénes compraron. Es la vista que el administrador (y
// GLENIS IA) usan para saber cuánto entró sin recorrer orden por orden.
router.get(
  '/manual-orders/summary',
  [
    query('status').optional().isIn(['pending', 'approved', 'rejected']),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const summary = await manualPaymentService.purchaseSummary({
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
    });
    res.json(summary);
  })
);

// Sugerencias del asistente para las órdenes pendientes. Solo lee y propone:
// ninguna orden se mueve por llamar aquí. Si el asistente no está configurado,
// `configured: false` y la lista vacía.
router.get(
  '/manual-orders/review',
  asyncHandler(async (_req, res) => {
    const result = await manualPaymentService.reviewPending({ limit: 20 });
    res.json(result);
  })
);

// Aplica la aprobación automática del asistente. Va detrás de
// MANUAL_AUTO_APPROVE; apagada, no aprueba nada aunque se llame.
router.post(
  '/manual-orders/auto-approve',
  asyncHandler(async (_req, res) => {
    const result = await manualPaymentService.autoApprovePending({ limit: 20 });
    res.json(result);
  })
);

router.post(
  '/manual-orders/:id/approve',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const result = await manualPaymentService.approveOrder({
      orderId: req.params.id,
      adminId: req.user.userId,
    });
    res.json(result);
  })
);

router.post(
  '/manual-orders/:id/reject',
  [param('id').isMongoId(), body('reason').optional().isString().trim().isLength({ max: 300 })],
  validate,
  asyncHandler(async (req, res) => {
    const order = await manualPaymentService.rejectOrder({
      orderId: req.params.id,
      adminId: req.user.userId,
      reason: req.body.reason,
    });
    res.json({ order });
  })
);

// Cola de retiros de Diamantes. Pagar aquí no mueve saldo (se descontó al
// solicitarlo): solo marca la solicitud como pagada para que quede registrado
// quién la pagó. Rechazar sí devuelve los Diamantes al usuario.
router.get(
  '/withdrawals',
  [query('status').optional().isIn(['pending', 'completed', 'rejected'])],
  validate,
  asyncHandler(async (req, res) => {
    const withdrawals = await walletService.listWithdrawals({
      status: req.query.status || 'pending',
    });
    res.json({ withdrawals });
  })
);

router.post(
  '/withdrawals/:id/pay',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const result = await walletService.payWithdrawal({
      transactionId: req.params.id,
      adminId: req.user.userId,
    });
    res.json(result);
  })
);

router.post(
  '/withdrawals/:id/reject',
  [param('id').isMongoId(), body('reason').optional().isString().trim().isLength({ max: 300 })],
  validate,
  asyncHandler(async (req, res) => {
    const result = await walletService.rejectWithdrawal({
      transactionId: req.params.id,
      adminId: req.user.userId,
      reason: req.body.reason,
    });
    res.json(result);
  })
);

// Torneos de POKERTAK. El administrador los organiza desde aquí (o pidiéndoselo
// a Asistak, que usa estas mismas funciones); el jugador se inscribe desde el
// móvil. Listar y ver van dentro de `requireAdmin` como el resto del router.
router.get(
  '/poker-events',
  [query('status').optional().isIn(['scheduled', 'running', 'finished', 'cancelled'])],
  validate,
  asyncHandler(async (req, res) => {
    const events = await pokerEventService.listEvents({ status: req.query.status, limit: 50 });
    res.json({ events });
  })
);

router.post(
  '/poker-events',
  [
    body('title').isString().trim().isLength({ min: 3, max: 80 }),
    body('squadSlug').isString().trim().isLength({ min: 1, max: 60 }),
    body('scheduledAt').isISO8601(),
    body('entryCost').isFloat({ gt: 0 }),
    body('maxPlayers').isInt({ min: 2, max: 9 }),
    body('rakeRate').optional().isFloat({ min: 0, max: 1 }),
    body('split').optional().isArray({ min: 1, max: 6 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const event = await pokerEventService.createEvent({
      title: req.body.title,
      adminId: req.user.userId,
      squadSlug: req.body.squadSlug,
      scheduledAt: req.body.scheduledAt,
      entryCost: req.body.entryCost,
      maxPlayers: req.body.maxPlayers,
      rakeRate: req.body.rakeRate,
      split: req.body.split,
    });
    res.status(201).json({ event: pokerEventService.publicEvent(event) });
  })
);

router.get(
  '/poker-events/:id',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const event = await pokerEventService.getEvent(req.params.id);
    if (!event) throw new HttpError(404, 'Evento no encontrado');
    res.json({ event });
  })
);

router.post(
  '/poker-events/:id/finish',
  [param('id').isMongoId(), body('ranking').optional().isArray({ max: 9 })],
  validate,
  asyncHandler(async (req, res) => {
    const result = await pokerEventService.finishEvent({
      eventId: req.params.id,
      ranking: req.body.ranking,
    });
    res.json({ event: pokerEventService.publicEvent(result.event), payout: result.payout });
  })
);

router.post(
  '/poker-events/:id/cancel',
  [param('id').isMongoId(), body('reason').optional().isString().trim().isLength({ max: 300 })],
  validate,
  asyncHandler(async (req, res) => {
    const result = await pokerEventService.cancelEvent({
      eventId: req.params.id,
      reason: req.body.reason,
    });
    res.json({ event: pokerEventService.publicEvent(result.event), refunded: result.refunded });
  })
);

module.exports = router;
