const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const posts = require('../services/postService');
const env = require('../config/env');
const attachments = require('../lib/attachments');
const { auth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Los adjuntos de Facetak viven en su propia subcarpeta de `uploads`, separados de
// los del chat y de los vídeos del feed: así un borrado o un listado de un tipo
// no toca los otros.
const WALL_DIR = path.join(env.uploadsDir, 'wall');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(WALL_DIR, { recursive: true });
      cb(null, WALL_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // El nombre en disco es aleatorio; el original se guarda en la publicación y
    // es el que se muestra. Así dos archivos con el mismo nombre no se pisan.
    cb(null, attachments.storedName(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Math.max(...Object.values(attachments.MAX_BYTES)) },
});

// Escribir en Facetak se limita para que una sola cuenta no lo inunde. La
// lectura no se limita más allá del limitador global. Se salta en las pruebas.
const writeLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Publicas demasiado rápido, espera un momento' },
    });

// Facetak general. Lectura pública, como el feed: un visitante sin sesión puede
// verlo. El `optionalAuth` es lo que rellena `liked` cuando sí hay sesión.
router.get(
  '/',
  optionalAuth,
  [
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('cursor').optional().isISO8601(),
    query('authorId').optional().isMongoId().withMessage('Autor inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await posts.listFeed({
      viewerId: req.user?.userId,
      cursor: req.query.cursor,
      limit: Number(req.query.limit) || posts.PAGE_SIZE,
      authorId: req.query.authorId,
    });
    res.json(result);
  })
);

// Sube una imagen o un vídeo para adjuntarlo a una publicación. Devuelve la
// referencia que luego se envía al crear la publicación; no la crea por sí
// sola, para que el usuario pueda escribir el pie antes de publicar.
router.post(
  '/attachments',
  auth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    let info;
    try {
      info = attachments.validateAttachment(req.file);
    } catch (err) {
      // El archivo ya está en disco: si no se acepta, no debe quedarse ahí.
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      throw new HttpError(400, err.message);
    }

    // En Facetak solo tienen sentido imagen y vídeo; un PDF o un zip no se
    // pintan en una tarjeta.
    if (info.kind !== 'image' && info.kind !== 'video') {
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
      throw new HttpError(400, 'Solo se pueden adjuntar imágenes o vídeos');
    }

    res.status(201).json({
      attachment: {
        kind: info.kind,
        url: `/uploads/wall/${path.basename(req.file.path)}`,
        name: attachments.safeName(req.file.originalname),
        size: req.file.size,
      },
    });
  })
);

// Una publicación concreta.
router.get(
  '/:postId',
  optionalAuth,
  [param('postId').isMongoId().withMessage('Publicación inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const post = await posts.getPost({ postId: req.params.postId, viewerId: req.user?.userId });
    res.json(post);
  })
);

router.post(
  '/',
  auth,
  writeLimiter,
  [
    body('text').optional({ values: 'null' }).isString().isLength({ max: 2000 }),
    body('attachment').optional({ values: 'null' }).isObject(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const post = await posts.createPost({
      authorId: req.user.userId,
      text: req.body.text,
      attachment: req.body.attachment,
    });
    res.status(201).json(post);
  })
);

router.delete(
  '/:postId',
  auth,
  [param('postId').isMongoId().withMessage('Publicación inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await posts.deletePost({
      postId: req.params.postId,
      actorId: req.user.userId,
      actorRole: req.user.role,
    });
    res.json(result);
  })
);

// Me gusta / quitar me gusta.
router.post(
  '/:postId/like',
  auth,
  [param('postId').isMongoId().withMessage('Publicación inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await posts.toggleLike({ postId: req.params.postId, userId: req.user.userId });
    res.json(result);
  })
);

// Comentarios de una publicación.
router.get(
  '/:postId/comments',
  optionalAuth,
  [param('postId').isMongoId().withMessage('Publicación inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await posts.listComments({ postId: req.params.postId });
    res.json(result);
  })
);

router.post(
  '/:postId/comments',
  auth,
  writeLimiter,
  [
    param('postId').isMongoId().withMessage('Publicación inválida'),
    body('text').trim().notEmpty().withMessage('El comentario no puede estar vacío').isLength({ max: 500 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const comment = await posts.createComment({
      postId: req.params.postId,
      authorId: req.user.userId,
      text: req.body.text,
    });
    res.status(201).json(comment);
  })
);

router.delete(
  '/comments/:commentId',
  auth,
  [param('commentId').isMongoId().withMessage('Comentario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await posts.deleteComment({
      commentId: req.params.commentId,
      actorId: req.user.userId,
      actorRole: req.user.role,
    });
    res.json(result);
  })
);

router.post(
  '/comments/:commentId/like',
  auth,
  [param('commentId').isMongoId().withMessage('Comentario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await posts.toggleCommentLike({
      commentId: req.params.commentId,
      userId: req.user.userId,
    });
    res.json(result);
  })
);

module.exports = router;
