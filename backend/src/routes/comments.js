const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const commentService = require('../services/commentService');
const env = require('../config/env');
const { auth, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { asyncHandler, HttpError } = require('../utils/http');

const router = express.Router();

// Writing is limited so a single account cannot flood a thread. Reading is not
// limited beyond the global API limiter. Skipped in tests, where a suite
// legitimately posts more comments than a person would.
const writeLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Escribes demasiado rápido, espera un momento' },
    });

const listRules = [
  param('videoId').isMongoId().withMessage('Video inválido'),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('cursor').optional().isISO8601(),
];

// Comments of a video, newest first, keyset-paginated by createdAt. Public
// read, like the video itself; the service applies the video's own visibility
// rules so a restricted video hides its thread too.
router.get(
  '/video/:videoId',
  optionalAuth,
  listRules,
  validate,
  asyncHandler(async (req, res) => {
    const result = await commentService.listComments({
      videoId: req.params.videoId,
      viewerId: req.user?.userId,
      cursor: req.query.cursor,
      limit: Number(req.query.limit) || 20,
    });
    res.json(result);
  })
);

// Replies of a top-level comment.
router.get(
  '/:commentId/replies',
  optionalAuth,
  [param('commentId').isMongoId().withMessage('Comentario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await commentService.listReplies({
      commentId: req.params.commentId,
      viewerId: req.user?.userId,
    });
    res.json(result);
  })
);

router.post(
  '/video/:videoId',
  auth,
  writeLimiter,
  [
    param('videoId').isMongoId().withMessage('Video inválido'),
    body('text').trim().notEmpty().withMessage('El comentario no puede estar vacío').isLength({ max: 500 }),
    body('parentId').optional({ values: 'null' }).isMongoId().withMessage('Comentario padre inválido'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const comment = await commentService.createComment({
      videoId: req.params.videoId,
      authorId: req.user.userId,
      text: req.body.text,
      parentId: req.body.parentId || null,
    });
    res.status(201).json({ comment });
  })
);

// Like toggle on a comment.
router.post(
  '/:commentId/like',
  auth,
  [param('commentId').isMongoId().withMessage('Comentario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await commentService.toggleLike({
      commentId: req.params.commentId,
      userId: req.user.userId,
    });
    res.json(result);
  })
);

// Delete. The service checks the author or an administrator; a client that
// calls this on someone else's comment gets a 403, not a silent success.
router.delete(
  '/:commentId',
  auth,
  [param('commentId').isMongoId().withMessage('Comentario inválido')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await commentService.deleteComment({
      commentId: req.params.commentId,
      actorId: req.user.userId,
      actorRole: req.user.role,
    });
    res.json(result);
  })
);

module.exports = router;
