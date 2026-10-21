const crypto = require('crypto');
const express = require('express');
const { body, param } = require('express-validator');
const Squad = require('../models/Squad');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// Discovery: public squads plus any squad the caller already belongs to.
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const squads = await Squad.find({
      $or: [{ visibility: 'public' }, { 'members.user': req.user.userId }],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('owner', 'username profile.displayName profile.avatar');

    res.json({ squads });
  })
);

router.post(
  '/',
  auth,
  [
    body('name').trim().isLength({ min: 3, max: 50 }).withMessage('Nombre inválido'),
    body('description').optional().trim().isLength({ max: 300 }),
    body('visibility').optional().isIn(['public', 'private']),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const base = slugify(req.body.name) || 'squad';
    // Slugs are user-visible and must be unique; retry on collision rather than
    // failing the request.
    let slug = base;
    for (let attempt = 0; attempt < 5 && (await Squad.exists({ slug })); attempt += 1) {
      slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    }

    const squad = await Squad.create({
      name: req.body.name,
      slug,
      description: req.body.description,
      visibility: req.body.visibility || 'private',
      owner: req.user.userId,
      joinCode: crypto.randomBytes(6).toString('hex'),
      voiceRoom: `squad-${slug}`,
      members: [{ user: req.user.userId, role: 'owner' }],
    });

    res.status(201).json({ squad: { ...squad.toObject(), joinCode: undefined } });
  })
);

// Join. Public squads are open; private squads need the invite code.
router.post(
  '/:slug/join',
  auth,
  [param('slug').trim().notEmpty(), body('joinCode').optional().trim()],
  validate,
  asyncHandler(async (req, res) => {
    const squad = await Squad.findOne({ slug: req.params.slug }).select('+joinCode');
    if (!squad) throw new HttpError(404, 'Creator no encontrado');

    if (squad.isMember(req.user.userId)) {
      return res.json({ joined: true, alreadyMember: true });
    }

    if (squad.visibility === 'private' && squad.joinCode !== req.body.joinCode) {
      throw new HttpError(403, 'Se requiere un código de invitación válido');
    }

    // `$addToSet` on the subdocument array keeps joins idempotent.
    await Squad.updateOne(
      { _id: squad._id },
      { $push: { members: { user: req.user.userId, role: 'member' } } }
    );

    res.json({ joined: true, voiceRoom: squad.voiceRoom });
  })
);

router.delete(
  '/:slug/leave',
  auth,
  [param('slug').trim().notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const squad = await Squad.findOne({ slug: req.params.slug });
    if (!squad) throw new HttpError(404, 'Creator no encontrado');
    if (squad.isOwner(req.user.userId)) {
      throw new HttpError(400, 'El propietario no puede salir de su propio creator');
    }

    await Squad.updateOne(
      { _id: squad._id },
      { $pull: { members: { user: req.user.userId } } }
    );

    res.json({ joined: false });
  })
);

// Members only: the exclusive content feed of the squad.
router.get(
  '/:slug/feed',
  auth,
  [param('slug').trim().notEmpty()],
  validate,
  asyncHandler(async (req, res) => {
    const squad = await Squad.findOne({ slug: req.params.slug });
    if (!squad) throw new HttpError(404, 'Creator no encontrado');
    if (squad.visibility === 'private' && !squad.isMember(req.user.userId)) {
      throw new HttpError(403, 'Debes ser miembro del squad para ver su contenido');
    }

    const members = await User.find({ _id: { $in: squad.members.map((m) => m.user) } })
      .select('username profile.displayName profile.avatar')
      .limit(100);

    res.json({ squad: { name: squad.name, slug: squad.slug }, members });
  })
);

module.exports = router;
