const express = require('express');
const Video = require('../models/Video');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

// Reasons a piece of content can lose reach. Each is a concrete, checkable
// condition so the creator is never left guessing, which is the core complaint
// about opaque "shadowbans" elsewhere.
const REACH_RULES = [
  {
    id: 'rejected',
    severity: 'blocked',
    label: 'Contenido retirado por moderación',
    test: (v) => v.moderationStatus === 'rejected',
  },
  {
    id: 'pending_review',
    severity: 'limited',
    label: 'En revisión de moderación (no se muestra en el feed)',
    test: (v) => v.moderationStatus === 'pending',
  },
  {
    id: 'nsfw',
    severity: 'limited',
    label: 'Marcado como NSFW: distribuido solo a mayores de edad',
    test: (v) => v.isNSFW === true,
  },
  {
    id: 'no_tags',
    severity: 'tip',
    label: 'Sin etiquetas: añade tags para mejorar el alcance',
    test: (v) => !v.tags || v.tags.length === 0,
  },
  {
    id: 'no_thumbnail',
    severity: 'tip',
    label: 'Sin miniatura: puede reducir la retención',
    test: (v) => !v.thumbnailUrl,
  },
];

// Transparent account-health report: exactly which videos are limited, by which
// rule, and what to do about it. No hidden penalties.
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId).select('profile stats createdAt');
    const videos = await Video.find({ creator: req.user.userId }).select(
      'title moderationStatus isNSFW tags thumbnailUrl views likes comments shares gifts createdAt'
    );

    const findings = [];
    const counts = { blocked: 0, limited: 0, tip: 0 };

    for (const video of videos) {
      const hits = REACH_RULES.filter((rule) => rule.test(video));
      for (const rule of hits) {
        counts[rule.severity] += 1;
        findings.push({
          videoId: video._id,
          title: video.title,
          rule: rule.id,
          severity: rule.severity,
          message: rule.label,
        });
      }
    }

    // Reach score: start at 100 and subtract a fixed, published penalty per
    // finding so the number is explainable rather than a black box.
    const penalties = { blocked: 40, limited: 15, tip: 3 };
    const score = Math.max(
      0,
      100 -
        counts.blocked * penalties.blocked -
        counts.limited * penalties.limited -
        counts.tip * penalties.tip
    );

    res.json({
      score,
      visibility:
        score >= 80 ? 'alta' : score >= 50 ? 'reducida' : 'baja',
      shadowban: false,
      // Stated explicitly: TAK TAK does not apply undisclosed penalties.
      policy: 'No aplicamos penalizaciones ocultas. Todo lo que limita tu alcance aparece en esta lista.',
      summary: {
        videos: videos.length,
        ...counts,
      },
      findings,
    });
  })
);

module.exports = router;
