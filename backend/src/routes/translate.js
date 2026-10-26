const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const translationService = require('../services/translationService');
const { auth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');
const { LANGUAGES, normalizeLanguage, detectLanguage, planTranslation } = require('../lib/language');
const env = require('../config/env');

const router = express.Router();

// Traducir cuesta dinero por llamada, así que lleva su propio límite: es el
// único endpoint de la app donde un bucle de un cliente se traduce en factura.
// Se salta en tests, donde una suite hace legítimamente más peticiones que una
// persona.
const translateLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiadas traducciones seguidas, espera un momento' },
    });

// Catálogo de idiomas del selector. Es público porque la pantalla de idioma se
// puede ver antes de iniciar sesión, y no revela nada.
router.get('/languages', (req, res) => {
  res.json({
    languages: LANGUAGES,
    // Si hay proveedor real o solo el local. La interfaz lo usa para avisar de
    // que la traducción no está activa en este despliegue, en vez de dejar al
    // usuario pulsando un botón que no hace nada.
    configured: translationService.isConfigured(),
  });
});

// Detección de idioma suelta. Sirve para que el cliente pueda saber en qué
// idioma escribe alguien antes de enviar (por ejemplo, para no traducir un
// mensaje que ya está en el idioma del destinatario).
router.post(
  '/detect',
  optionalAuth,
  [body('text').isString().trim().notEmpty().withMessage('Texto requerido').isLength({ max: 2000 })],
  validate,
  asyncHandler(async (req, res) => {
    res.json(detectLanguage(req.body.text));
  })
);

// Plan de traducción sin ejecutarlo: dice si haría falta traducir y de qué a
// qué. Lo usa el chat para decidir si muestra el botón de traducir en una
// burbuja, sin gastar una traducción solo por pintarlo.
router.post(
  '/plan',
  optionalAuth,
  [
    body('text').isString().trim().notEmpty().withMessage('Texto requerido').isLength({ max: 2000 }),
    body('to').isString().trim().notEmpty().withMessage('Idioma de destino requerido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const target = normalizeLanguage(req.body.to);
    if (!target) throw new HttpError(400, 'Idioma de destino no soportado');
    res.json(planTranslation({ text: req.body.text, target, hint: req.body.hint || null }));
  })
);

// Traducción. Va autenticado porque el límite por persona solo tiene sentido con
// sesión, y porque es una función de la app, no un servicio público de
// traducción que cualquiera pueda usar como API gratis.
router.post(
  '/',
  auth,
  translateLimiter,
  [
    body('text').isString().trim().notEmpty().withMessage('Texto requerido').isLength({ max: 5000 }),
    body('to').isString().trim().notEmpty().withMessage('Idioma de destino requerido'),
    body('from').optional({ nullable: true }).isString().trim(),
    body('hint').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await translationService.translate({
      text: req.body.text,
      to: req.body.to,
      from: req.body.from || null,
      hint: req.body.hint || null,
    });
    res.json(result);
  })
);

// Traducción de un lote. Se usa al abrir un hilo: se traducen de una vez los
// últimos mensajes del otro en lugar de una petición por burbuja, que con un
// límite por minuto daría 429 en cuanto el hilo tuviera veinte mensajes.
router.post(
  '/batch',
  auth,
  translateLimiter,
  [
    body('texts').isArray({ min: 1, max: 30 }).withMessage('Se esperan entre 1 y 30 textos'),
    body('texts.*').isString().isLength({ max: 5000 }),
    body('to').isString().trim().notEmpty().withMessage('Idioma de destino requerido'),
    body('hint').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const target = normalizeLanguage(req.body.to);
    if (!target) throw new HttpError(400, 'Idioma de destino no soportado');

    const results = await translationService.translateMany(req.body.texts, {
      to: target,
      hint: req.body.hint || null,
    });
    res.json({ translations: results });
  })
);

module.exports = router;
