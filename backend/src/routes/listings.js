const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const listings = require('../services/listingService');
const env = require('../config/env');
const attachments = require('../lib/attachments');
const { auth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Las fotos de Marketak viven en su propia subcarpeta de `uploads`, separadas
// de las de Facetak y el chat: así un borrado o un listado de un tipo no toca
// los otros.
const MARKET_DIR = path.join(env.uploadsDir, 'market');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(MARKET_DIR, { recursive: true });
      cb(null, MARKET_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // El nombre en disco es aleatorio; el original se guarda en el anuncio.
    cb(null, attachments.storedName(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Math.max(...Object.values(attachments.MAX_BYTES)) },
});

// Publicar en Marketak se limita para que una sola cuenta no lo inunde. La
// lectura no se limita más allá del limitador global. Se salta en las pruebas.
const writeLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Publicas anuncios demasiado rápido, espera un momento' },
    });

// Listado general de Marketak. Lectura pública, como Facetak: un visitante
// puede verlo sin cuenta. Publicar y contactar sí piden sesión.
router.get(
  '/',
  optionalAuth,
  [
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('cursor').optional().isISO8601(),
    query('category').optional().isString().isLength({ max: 30 }),
    query('q').optional().isString().isLength({ max: 60 }),
    query('sellerId').optional().isMongoId().withMessage('Vendedor inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await listings.listListings({
      cursor: req.query.cursor,
      limit: Number(req.query.limit) || listings.PAGE_SIZE,
      category: req.query.category,
      q: req.query.q,
      sellerId: req.query.sellerId,
    });
    res.json(result);
  })
);

// Sube una foto para un anuncio. Devuelve la referencia que luego se envía al
// crear el anuncio; no lo crea por sí sola, para poder ver la vista previa.
router.post(
  '/photos',
  auth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    let info;
    try {
      info = attachments.validateAttachment(req.file);
    } catch (err) {
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      throw new HttpError(400, err.message);
    }

    // Un anuncio solo se ilustra con imágenes; un vídeo o un PDF no pintan en
    // una cuadrícula.
    if (info.kind !== 'image') {
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
      throw new HttpError(400, 'Solo se pueden subir imágenes');
    }

    res.status(201).json({
      photo: {
        url: `/uploads/market/${path.basename(req.file.path)}`,
        name: attachments.safeName(req.file.originalname),
        size: req.file.size,
      },
    });
  })
);

// Un anuncio concreto.
router.get(
  '/:listingId',
  optionalAuth,
  [param('listingId').isMongoId().withMessage('Anuncio inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const listing = await listings.getListing({ listingId: req.params.listingId });
    res.json(listing);
  })
);

router.post(
  '/',
  auth,
  writeLimiter,
  [
    body('title').trim().notEmpty().withMessage('El anuncio necesita un título').isLength({ max: 100 }),
    body('description').optional({ values: 'null' }).isString().isLength({ max: 2000 }),
    body('price').isInt({ min: 0, max: 100000000 }).withMessage('Precio inválido'),
    body('category').optional().isString().isLength({ max: 30 }),
    body('condition').optional().isIn(['nuevo', 'como_nuevo', 'usado']),
    body('location').optional({ values: 'null' }).isString().isLength({ max: 80 }),
    body('photos').optional().isArray({ max: 8 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const listing = await listings.createListing({
      sellerId: req.user.userId,
      title: req.body.title,
      description: req.body.description,
      price: req.body.price,
      category: req.body.category,
      condition: req.body.condition,
      location: req.body.location,
      photos: req.body.photos,
    });
    res.status(201).json(listing);
  })
);

// Marcar como vendido o volver a ponerlo a la venta. Solo el vendedor o admin.
router.patch(
  '/:listingId/status',
  auth,
  [
    param('listingId').isMongoId().withMessage('Anuncio inválido'),
    body('status').isIn(['active', 'sold']).withMessage('Estado inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await listings.setStatus({
      listingId: req.params.listingId,
      actorId: req.user.userId,
      actorRole: req.user.role,
      status: req.body.status,
    });
    res.json(result);
  })
);

router.delete(
  '/:listingId',
  auth,
  [param('listingId').isMongoId().withMessage('Anuncio inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await listings.deleteListing({
      listingId: req.params.listingId,
      actorId: req.user.userId,
      actorRole: req.user.role,
    });
    res.json(result);
  })
);

module.exports = router;
