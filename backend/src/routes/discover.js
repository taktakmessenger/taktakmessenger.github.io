const express = require('express');
const { Readable } = require('stream');
const { body, query } = require('express-validator');
const discoverService = require('../services/discoverService');
const storageService = require('../services/storageService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Buscar fuera de TAK TAK. Es público, como el buscador de la app: un visitante
// sin cuenta también puede mirar antes de decidir registrarse, y la búsqueda en
// sí no escribe nada.
router.get(
  '/search',
  [
    query('q').trim().notEmpty().withMessage('Falta el término de búsqueda').isLength({ max: 60 }),
    query('kind').optional().isIn(['all', 'music', 'video']),
    query('limit').optional().isInt({ min: 1, max: 30 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const results = await discoverService.search(req.query.q, {
      kind: req.query.kind || 'all',
      limit: Number(req.query.limit) || 20,
    });
    res.json(results);
  })
);

// Previsualización. El navegador no puede pedir el audio o la miniatura al
// origen (la CSP lo bloquea), así que lo sirve este proxy. Solo deja pasar URLs
// que el buscador acaba de ofrecer, y `openStream` vuelve a comprobar que el
// destino es público: es la misma guarda anti-SSRF que usa la importación.
router.get(
  '/preview',
  [query('url').trim().isURL().withMessage('URL inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const target = req.query.url;
    if (!discoverService.isKnownMediaUrl(target)) {
      throw new HttpError(404, 'Ese archivo no está en los resultados');
    }

    const { res: upstream } = await discoverService.openStream(target);
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);

    // `fetch` devuelve un ReadableStream web, no un stream de Node: hay que
    // envolverlo antes de poder hacer `pipe` (si no, "pipe is not a function").
    const body = Readable.fromWeb(upstream.body);
    body.pipe(res);
    body.on('error', () => res.destroy());
  })
);

// Traer a TAK TAK lo que se encontró fuera. Requiere sesión: lo importado se
// guarda en el bucket (cuesta dinero) y se atribuye a quien lo pide.
router.post(
  '/import',
  auth,
  [
    body('url').trim().isURL().withMessage('Enlace inválido'),
    body('kind').isIn(['music', 'video', 'image']).withMessage('Tipo inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { url, kind } = req.body;
    const stored = await discoverService.importFromUrl(url, {
      kind,
      prefix: `imported/${kind}`,
    });
    res.status(201).json({ url: stored.url, kind, size: stored.size });
  })
);

// Descarga del archivo ya importado, por nuestra propia API: así el navegador
// no depende de que el bucket mande CORS y el enlace funciona también en local.
router.get(
  '/file',
  [query('key').trim().notEmpty().withMessage('Falta la clave')],
  validate,
  asyncHandler(async (req, res) => {
    const key = String(req.query.key).replace(/^\/+/, '');
    // Solo se sirve lo importado: un prefijo arbitrario dejaría leer cualquier
    // objeto del bucket.
    if (!key.startsWith('imported/')) throw new HttpError(403, 'Clave no permitida');
    if (!storageService.isConfigured()) throw new HttpError(404, 'No hay almacenamiento externo');

    const object = await storageService.getObjectStream(key);
    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    if (object.ContentLength) res.setHeader('Content-Length', object.ContentLength);
    object.Body.pipe(res);
    object.Body.on('error', () => res.destroy());
  })
);

module.exports = router;
