const express = require('express');
const { query } = require('express-validator');
const searchService = require('../services/searchService');
const feedService = require('../services/feedService');
const { optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

// Descubrimiento. Es público (como el feed): un visitante sin cuenta también
// necesita encontrar a alguien antes de decidir registrarse.
//
// Va con `optionalAuth` y no con `auth` para que el contenido para adultos se
// filtre según quien mira, en vez de mostrar todo a un anónimo.
router.get(
  '/',
  optionalAuth,
  [
    query('q').optional().isString().trim().isLength({ max: 60 }),
    query('type').optional().isIn(['all', 'users', 'videos', 'tags']),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const term = String(req.query.q || '').trim();
    const canViewAdult = await feedService.canViewAdultContent(req.user?.userId);
    const results = await searchService.search(term, {
      viewerId: req.user?.userId || null,
      canViewAdult,
    });

    // `type` permite pedir una sola pestaña. Se filtra en memoria porque el
    // servicio ya trajo las tres listas: tres consultas para descartar dos es
    // trabajo de más en el caso normal (buscar en todo).
    const type = req.query.type || 'all';
    if (type === 'users') return res.json({ ...results, videos: [], tags: [] });
    if (type === 'videos') return res.json({ ...results, users: [], tags: [] });
    if (type === 'tags') return res.json({ ...results, users: [], videos: [] });

    return res.json(results);
  })
);

module.exports = router;
