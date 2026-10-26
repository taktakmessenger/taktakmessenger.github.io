const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const { body, param, query } = require('express-validator');
const Video = require('../models/Video');
const User = require('../models/User');
const NewsSource = require('../models/NewsSource');
const env = require('../config/env');
const transcodeService = require('../services/transcodeService');
const { isAcceptedVideo } = require('../lib/videoUpload');
const feedService = require('../services/feedService');
const newsService = require('../services/newsService');
const commentService = require('../services/commentService');
const notificationService = require('../services/notificationService');
const { auth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Uploads land on disk first; the HLS ladder is produced afterwards in the
// background so the request is not held open for a transcode.
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(env.uploadsDir, { recursive: true });
      cb(null, env.uploadsDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.mp4').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.maxVideoBytes },
  fileFilter: (req, file, cb) => {
    if (!isAcceptedVideo(file)) {
      return cb(new HttpError(400, 'Formato de video no soportado'));
    }
    return cb(null, true);
  },
});

// Kicks off the HLS ladder without blocking the response. A failure is stored
// on the video so the creator can see it instead of the upload silently
// staying as a plain file.
//
// `username` es el @usuario que se estampa en la marca de TAK TAK. Se pasa
// aparte del vídeo porque el marcador lo tiene en la sesión y así el reproceso
// no necesita otra consulta a la base.
function startTranscode(video, inputPath, username) {
  // The client-declared duration is a hint; measuring the file is the only way
  // to be sure, and analytics divides by it.
  transcodeService
    .probeDuration(inputPath)
    .then((duration) => {
      if (duration) {
        return Video.updateOne({ _id: video._id }, { duration });
      }
      return null;
    })
    .catch(() => {});

  transcodeService
    .processVideoToHLS(inputPath, env.uploadsDir, video._id.toString(), username)
    .then(async (result) => {
      if (!result) {
        await Video.updateOne({ _id: video._id }, { transcodeStatus: 'failed' });
        return;
      }
      await Video.updateOne(
        { _id: video._id },
        {
          hlsUrl: result.playlistUrl,
          thumbnailUrl: result.thumbnailUrl,
          transcodeStatus: 'ready',
          transcodeError: null,
        }
      );
    })
    .catch(async (err) => {
      console.error('[transcode] fallo:', err.message);
      await Video.updateOne(
        { _id: video._id },
        { transcodeStatus: 'failed', transcodeError: err.message }
      ).catch(() => {});
    });
}

const createRules = [
  body('title').trim().notEmpty().withMessage('El título es requerido').isLength({ max: 100 }),
  body('videoUrl').trim().isURL().withMessage('URL de video inválida'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('thumbnailUrl').optional({ values: 'falsy' }).trim().isURL(),
  body('duration').optional().isFloat({ min: 0 }),
  body('tags').optional().isArray({ max: 10 }),
  body('isNSFW').optional().isBoolean(),
  body('newsSource').optional().isMongoId().withMessage('Fuente de noticia inválida'),
  body('sourceUrl').optional({ values: 'falsy' }).trim().isURL().withMessage('Enlace de la noticia inválido'),
];

// News sources a creator can attribute a video to. Only verified sources are
// offered, since claiming an unverified one would never be grantable.
router.get(
  '/news-sources',
  asyncHandler(async (req, res) => {
    const sources = await NewsSource.find({ status: 'verified' })
      .select('name domains')
      .sort({ name: 1 })
      .limit(200);
    res.json({ sources });
  })
);

// Newest approved videos, keyset-paginated by createdAt.
router.get(
  '/',
  optionalAuth,
  [query('limit').optional().isInt({ min: 1, max: 50 }), query('cursor').optional().isISO8601()],
  validate,
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const filter = { moderationStatus: 'approved' };
    // Adult content stays out of the listing for anyone not age-verified,
    // including anonymous callers.
    if (!(await feedService.canViewAdultContent(req.user?.userId))) {
      filter.isNSFW = { $ne: true };
    }
    if (req.query.cursor) {
      filter.createdAt = { $lt: new Date(req.query.cursor) };
    }

    const videos = await Video.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('creator', 'username profile.displayName profile.avatar');

    res.json({
      videos,
      nextCursor: videos.length === limit ? videos[videos.length - 1].createdAt : null,
    });
  })
);

router.get(
  '/:id',
  optionalAuth,
  [param('id').isMongoId().withMessage('ID inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    ).populate('creator', 'username profile.displayName profile.avatar');

    if (!video || video.moderationStatus === 'rejected') {
      throw new HttpError(404, 'Video no encontrado');
    }

    // Adult content is hidden from viewers who have not passed age verification.
    // It answers 404 rather than 403 so the response does not confirm that a
    // restricted video exists. The creator keeps access to their own upload.
    if (video.isNSFW && String(video.creator?._id) !== String(req.user?.userId)) {
      if (!(await feedService.canViewAdultContent(req.user?.userId))) {
        throw new HttpError(404, 'Video no encontrado');
      }
    }

    res.json({ video });
  })
);

router.post(
  '/',
  auth,
  createRules,
  validate,
  asyncHandler(async (req, res) => {
    // Publishing adult content requires being age-verified. Without this an
    // unverified account could post NSFW and, because the feed withholds such
    // videos from unverified viewers, the uploader would be the only person who
    // could ever see it — a silent trap rather than a policy.
    if (req.body.isNSFW === true) {
      const user = await User.findById(req.user.userId);
      if (!user?.isAdult()) {
        throw new HttpError(403, 'Necesitas verificar tu edad para publicar contenido para adultos');
      }
    }

    // A news claim is checked at upload so an incoherent one fails immediately
    // instead of sitting in the review queue. It still grants nothing: the badge
    // is decided by an administrator, and re-validated at that point.
    if (req.body.newsSource) {
      await newsService.validateClaim({
        sourceId: req.body.newsSource,
        sourceUrl: req.body.sourceUrl,
      });
    }

    // Fields are copied one by one, never spread. A spread would let a client
    // set `newsVerified` (the badge), `views` or `likedBy` directly and skip the
    // review that gives those fields their meaning.
    const video = await Video.create({
      title: req.body.title,
      videoUrl: req.body.videoUrl,
      description: req.body.description,
      thumbnailUrl: req.body.thumbnailUrl,
      duration: req.body.duration,
      tags: req.body.tags,
      isNSFW: req.body.isNSFW === true,
      newsSource: req.body.newsSource || null,
      sourceUrl: req.body.sourceUrl,
      creator: req.user.userId,
      moderationStatus: 'approved',
    });

    // The uploader becomes a creator.
    await User.updateOne(
      { _id: req.user.userId },
      { $set: { 'profile.isCreator': true } }
    );

    res.status(201).json({ video });
  })
);

// Direct file upload (multipart). The original is stored and served right
// away, then the HLS ladder is generated in the background.
router.post(
  '/upload',
  auth,
  upload.single('video'),
  [
    body('title').trim().notEmpty().withMessage('El título es requerido').isLength({ max: 100 }),
    body('description').optional().trim().isLength({ max: 500 }),
    body('tags').optional().trim(),
    body('duration').optional().isFloat({ min: 0 }).toFloat(),
    // A multipart form delivers every value as a string, so the boolean arrives
    // as "true"/"false" and must be interpreted rather than passed through.
    body('isNSFW').optional().isIn(['true', 'false']).withMessage('Valor NSFW inválido'),
    body('newsSource').optional().isMongoId().withMessage('Fuente de noticia inválida'),
    body('sourceUrl').optional({ values: 'falsy' }).trim().isURL().withMessage('Enlace de la noticia inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Falta el archivo de video');

    const isNSFW = req.body.isNSFW === 'true';

    // Same two gates as the JSON endpoint: adult content requires a verified
    // age, and a news claim must be coherent before it enters the queue.
    if (isNSFW) {
      const user = await User.findById(req.user.userId);
      if (!user?.isAdult()) {
        throw new HttpError(403, 'Necesitas verificar tu edad para publicar contenido para adultos');
      }
    }
    if (req.body.newsSource) {
      await newsService.validateClaim({
        sourceId: req.body.newsSource,
        sourceUrl: req.body.sourceUrl,
      });
    }

    // `tags` arrives as a comma-separated string in a multipart form.
    const tags = req.body.tags
      ? req.body.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10)
      : [];

    const video = await Video.create({
      title: req.body.title,
      description: req.body.description,
      tags,
      duration: req.body.duration,
      videoUrl: `/uploads/${req.file.filename}`,
      isNSFW,
      newsSource: req.body.newsSource || null,
      sourceUrl: req.body.sourceUrl,
      creator: req.user.userId,
      moderationStatus: 'approved',
      transcodeStatus: 'processing',
    });

    await User.updateOne({ _id: req.user.userId }, { $set: { 'profile.isCreator': true } });

    // Fire and forget: the response must not wait for ffmpeg.
    startTranscode(video, req.file.path, req.user.username);

    res.status(201).json({ video });
  })
);

// Like toggle. The `likedBy` set is the source of truth: the conditional
// update only matches when the user is not already in it, so repeated taps are
// idempotent and the counter can never be inflated by a double-click.
router.post(
  '/:id/like',
  auth,
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const { userId } = req.user;

    const liked = await Video.findOneAndUpdate(
      { _id: req.params.id, likedBy: { $ne: userId } },
      { $addToSet: { likedBy: userId }, $inc: { likes: 1 } },
      { new: true }
    );

    if (liked) {
      await User.updateOne({ _id: liked.creator }, { $inc: { 'stats.totalLikes': 1 } });
      // Solo al dar el me gusta, no al quitarlo: avisar de un "ya no me gusta"
      // sería ruido. Y nunca a uno mismo, de eso se encarga el servicio.
      await notificationService.notify({
        recipientId: liked.creator,
        actorId: userId,
        type: 'like',
        video: liked._id,
      });
      return res.json({ likes: liked.likes, liked: true });
    }

    // Not newly liked, so this tap is an unlike. Matching on `likedBy: userId`
    // guarantees the decrement only happens once per existing like.
    const unliked = await Video.findOneAndUpdate(
      { _id: req.params.id, likedBy: userId },
      { $pull: { likedBy: userId }, $inc: { likes: -1 } },
      { new: true }
    );

    if (!unliked) throw new HttpError(404, 'Video no encontrado');

    await User.updateOne({ _id: unliked.creator }, { $inc: { 'stats.totalLikes': -1 } });
    res.json({ likes: unliked.likes, liked: false });
  })
);

router.delete(
  '/:id',
  auth,
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findById(req.params.id);
    if (!video) throw new HttpError(404, 'Video no encontrado');
    if (video.creator.toString() !== req.user.userId && req.user.role !== 'admin') {
      throw new HttpError(403, 'No autorizado para eliminar este video');
    }

    await video.deleteOne();
    // The thread goes with the video: leaving the comments behind would keep
    // their text readable through the comment endpoints after the video is gone.
    await commentService.removeForVideo(video._id);
    res.json({ deleted: true });
  })
);

// Clean export: the creator's own file with no platform watermark or logo
// overlay. Returned as a direct download descriptor; the stored file is the
// untouched original, so no re-encode is needed.
router.get(
  '/:id/export',
  auth,
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findById(req.params.id);
    if (!video) throw new HttpError(404, 'Video no encontrado');

    const isOwner = video.creator.toString() === req.user.userId;
    if (!isOwner && req.user.role !== 'admin') {
      throw new HttpError(403, 'Solo el creador puede exportar este video');
    }

    const ext = (video.videoUrl.split('.').pop() || 'mp4').split('?')[0];
    const safeTitle = video.title.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60);

    res.json({
      downloadUrl: video.videoUrl,
      filename: `${safeTitle || 'taktak'}-${video._id}.${ext}`,
      watermark: false,
      platformLogo: false,
      reencoded: false,
      message: 'Exportación limpia: sin marca de agua ni logo de TAK TAK.',
    });
  })
);

// Descarga de un video ajeno. A diferencia de `/:id/export`, que es solo para
// el creador, aquí cualquiera puede bajarse el video de otra persona, que es lo
// que se pidió. Se respeta la moderación: un video rechazado no existe y uno
// para adultos sigue oculto a quien no verificó su edad, igual que en GET /:id.
//
// El fichero que se sirve es el original ya subido, así que no hay reencode ni
// marca de agua que quitar.
router.get(
  '/:id/download',
  auth,
  [param('id').isMongoId().withMessage('ID inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findById(req.params.id).select(
      'title videoUrl creator moderationStatus isNSFW'
    );
    if (!video || video.moderationStatus === 'rejected') {
      throw new HttpError(404, 'Video no encontrado');
    }

    // El contenido para adultos se oculta a quien no lo puede ver. Se responde
    // 404 y no 403 para no confirmar que el video existe.
    if (video.isNSFW && String(video.creator) !== String(req.user.userId)) {
      if (!(await feedService.canViewAdultContent(req.user.userId))) {
        throw new HttpError(404, 'Video no encontrado');
      }
    }

    const ext = (video.videoUrl.split('.').pop() || 'mp4').split('?')[0];
    const safeTitle = video.title.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60);

    // El contador sube solo cuando la descarga se concede, no en cada intento
    // denegado. Es una señal de interés, como los "me gusta".
    await Video.updateOne({ _id: video._id }, { $inc: { downloads: 1 } });

    res.json({
      downloadUrl: video.videoUrl,
      filename: `${safeTitle || 'taktak'}-${video._id}.${ext}`,
      watermark: false,
      reencoded: false,
    });
  })
);

// Estado del transcode, sin efectos secundarios. Existe aparte de GET /:id
// porque ese endpoint incrementa el contador de vistas: sondearlo desde la
// pantalla de subida inflaría las vistas del propio creador.
router.get(
  '/:id/status',
  optionalAuth,
  [param('id').isMongoId().withMessage('ID inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findById(req.params.id).select(
      'transcodeStatus transcodeError hlsUrl duration creator'
    );
    if (!video) throw new HttpError(404, 'Video no encontrado');

    const isOwner = String(video.creator) === String(req.user?.userId);
    res.json({
      transcodeStatus: video.transcodeStatus,
      hlsUrl: video.hlsUrl || null,
      duration: video.duration ?? null,
      // El detalle del fallo es para el creador; a un tercero no le dice nada
      // útil y puede exponer rutas del servidor.
      transcodeError: isOwner ? video.transcodeError || null : null,
    });
  })
);

// Retranscode: vuelve a lanzar el HLS de un video ya subido. Existe porque un
// upload anterior a que hubiera ffmpeg (o un transcode que falló) deja el
// fichero original tal cual, y ese original puede ser H.265/HEVC de iPhone, que
// el navegador no reproduce. Es idempotente: se puede pedir varias veces.
router.post(
  '/:id/retranscode',
  auth,
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findById(req.params.id);
    if (!video) throw new HttpError(404, 'Video no encontrado');

    const isOwner = video.creator.toString() === req.user.userId;
    if (!isOwner && req.user.role !== 'admin') {
      throw new HttpError(403, 'Solo el creador puede reprocesar este video');
    }

    if (!(await transcodeService.hasFfmpeg())) {
      throw new HttpError(
        503,
        'La conversión de video no está disponible en este servidor (falta ffmpeg)'
      );
    }

    const inputPath = path.join(env.uploadsDir, path.basename(video.videoUrl));
    try {
      await fs.access(inputPath);
    } catch {
      throw new HttpError(404, 'El archivo original ya no está disponible');
    }

    // En segundo plano, igual que en la subida: un vídeo largo tardaría más que
    // el tiempo de espera del proxy y la respuesta se cortaría.
    await Video.updateOne({ _id: video._id }, { transcodeStatus: 'processing' });
    // La marca lleva el @usuario del creador, no el de quien reprocesa: un
    // admin puede reprocesar el vídeo de otra persona y la autoría no cambia.
    const owner = await User.findById(video.creator).select('username');
    startTranscode(video, inputPath, owner?.username);

    res.status(202).json({ queued: true, transcodeStatus: 'processing' });
  })
);

// Compartir un vídeo. Antes el botón ➦ solo abría la hoja: el contador `shares`
// nunca subía y el ranking le daba el mayor de sus pesos a una señal muerta.
//
// Es idempotente por persona (`sharedBy`, como `likedBy`): compartir el mismo
// vídeo cinco veces no lo hace cinco veces más relevante, y sin la lista
// cualquiera podría inflar el número a mano.
router.post(
  '/:id/share',
  auth,
  [param('id').isMongoId().withMessage('ID inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const video = await Video.findOneAndUpdate(
      { _id: req.params.id, sharedBy: { $ne: req.user.userId } },
      { $addToSet: { sharedBy: req.user.userId }, $inc: { shares: 1 } },
      { new: true }
    ).select('shares');

    // Sin coincidencia puede ser "ya lo compartió" o "no existe". Se distingue
    // para no inventar un contador en un vídeo inexistente.
    if (!video) {
      const exists = await Video.exists({ _id: req.params.id });
      if (!exists) throw new HttpError(404, 'Video no encontrado');
      const current = await Video.findById(req.params.id).select('shares');
      return res.json({ shares: current.shares, shared: true });
    }

    res.json({ shares: video.shares, shared: true });
  })
);

module.exports = router;
