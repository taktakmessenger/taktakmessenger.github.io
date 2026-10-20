const express = require('express');
const { body } = require('express-validator');
const User = require('../models/User');
const ageService = require('../services/ageService');
const newsService = require('../services/newsService');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Age verification, from the account's own side.
router.use(auth);

// Current state, so the UI can show "verify" or "verified" without guessing.
router.get(
  '/age',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId).select('ageVerification');
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json({
      status: user.ageVerification?.status || 'unverified',
      verifiedAt: user.ageVerification?.verifiedAt || null,
    });
  })
);

// Opens a verification session with the provider and returns where to send the
// user. The account moves to `pending`; nothing is granted here.
router.post(
  '/age/start',
  asyncHandler(async (req, res) => {
    const result = await ageService.startVerification(req.user.userId);
    res.json(result);
  })
);

// Polls the provider for a verdict after the user returns from its flow. This
// is the only user-facing path that can turn the account `verified`, and it
// only reflects what the provider decided.
router.post(
  '/age/refresh',
  asyncHandler(async (req, res) => {
    const result = await ageService.refreshVerification(req.user.userId);
    res.json(result);
  })
);

// Records the self-declared date of birth. Kept for the record and for
// showing an age-appropriate experience, but it deliberately does not change
// `ageVerification.status`: a declaration is not a verification.
router.put(
  '/age/declaration',
  [body('dateOfBirth').isISO8601().withMessage('Fecha de nacimiento inválida')],
  validate,
  asyncHandler(async (req, res) => {
    const dob = new Date(req.body.dateOfBirth);
    if (dob > new Date()) throw new HttpError(400, 'La fecha no puede ser futura');

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: { dateOfBirth: dob } },
      { new: true }
    );
    if (!user) throw new HttpError(404, 'Usuario no encontrado');

    res.json({
      dateOfBirth: dob,
      status: user.ageVerification?.status || 'unverified',
    });
  })
);

// Proposes a news outlet for review. Anyone may propose one; only an
// administrator can verify it, which is what keeps the badge meaningful.
router.post(
  '/news-sources',
  [
    body('name').trim().notEmpty().withMessage('El nombre de la fuente es requerido').isLength({ max: 120 }),
    body('domains').optional().isArray({ max: 20 }).withMessage('Dominios inválidos'),
    body('domains.*').optional().trim().isLength({ max: 253 }),
    body('evidenceUrl').optional({ values: 'falsy' }).trim().isURL().withMessage('Enlace de evidencia inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const source = await newsService.proposeSource({
      name: req.body.name,
      domains: req.body.domains || [],
      evidenceUrl: req.body.evidenceUrl,
      submittedBy: req.user.userId,
    });
    res.status(201).json({ source });
  })
);

module.exports = router;
