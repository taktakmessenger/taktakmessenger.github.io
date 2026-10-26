const mongoose = require('mongoose');
const Video = require('../models/Video');
const WatchEvent = require('../models/WatchEvent');
const User = require('../models/User');
const env = require('../config/env');
const { rerank } = require('./rankingService');

// A watch only counts as a signal when the viewer stayed past a floor *and*
// got through most of the clip. Using raw seconds alone would let a long video
// dominate the taste profile of someone who abandoned it.
const MIN_WATCH_SECONDS = 5;
const MIN_COMPLETION_RATE = 0.6;

// Tag affinity is expressed as a scoring bonus, not a hard filter. A strict
// `tags: {$in: preferred}` query would show a viewer nothing at all once their
// preferred tags run dry.
const TAG_BONUS = Number(process.env.FEED_TAG_BONUS ?? 1000);

/**
 * Build a For You page.
 *
 * Two-stage pipeline, mirroring how large recommenders are actually built:
 *
 *  1. Retrieval (in Mongo): cheap pre-filtering to a candidate pool. Drops
 *     videos the viewer already saw, rejected videos, and blocked creators.
 *  2. Ranking (in `rankingService`): the multi-objective value function,
 *     recency decay, cold-start exploration and creator diversity.
 *
 * Ranking is deliberately not expressed as a Mongo `$sort`. It needs log
 * compression, exponential decay and per-creator capping, none of which the
 * aggregation pipeline can express readably — and keeping it in JS means the
 * exact same formula the tests exercise is the one that ships.
 */
async function getForYouFeed(userId, { limit = 10, page = 1, excludeVideoIds = [] } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);

  const [preferredTags, seen, hiddenCreators, hiddenTags, adultOk, blockedIds] =
    await Promise.all([
      getPreferredTags(userId),
      getRecentlyWatchedVideoIds(userId),
      getHiddenCreatorIds(userId),
      getHiddenTags(userId),
      canViewAdultContent(userId),
      getBlockedCreatorIds(userId),
    ]);

  const excluded = [...new Set([...seen, ...excludeVideoIds].map(String))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const match = { moderationStatus: 'approved' };
  // Adult content is withheld from anyone who has not passed age verification,
  // including anonymous visitors. This is a retrieval-stage filter on purpose:
  // a ranking bonus would still leak the video into the page.
  if (!adultOk) match.isNSFW = { $ne: true };
  if (excluded.length) match._id = { $nin: excluded };
  if (hiddenTags.length) match.tags = { $nin: hiddenTags };

  // Los creadores ocultos y los bloqueados se filtran juntos: son dos listas
  // distintas pero un solo campo de Mongo (`creator`). Asignar una después de la
  // otra borraría la primera, así que se unen antes de escribir el filtro.
  //
  // "No me interesa" es una preferencia de recomendación; el bloqueo es una
  // decisión de seguridad que además corta el contacto. Para el feed el efecto
  // es el mismo: ese creador no aparece.
  const mutedCreators = [...new Set([...hiddenCreators, ...blockedIds].map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  if (mutedCreators.length) match.creator = { $nin: mutedCreators };

  // Fetch a candidate pool far larger than the page, then rank it. The pool is
  // bounded so a huge library cannot make one request unbounded work.
  const poolSize = Math.max(env.feedCandidatePool, safeLimit * safePage * 4);

  const candidates = await Video.aggregate([
    { $match: match },
    // Order the pool by the signals Mongo can index, so the pool itself is
    // plausible even before ranking. `_id` is a stable final tie-break.
    { $sort: { likes: -1, views: -1, createdAt: -1, _id: -1 } },
    { $limit: poolSize },
  ]);

  await Video.populate(candidates, {
    path: 'creator',
    select: 'username profile.displayName profile.avatar',
  });

  // Tag affinity is applied here rather than in the pipeline so a viewer with
  // no history falls back to pure popularity instead of an empty bonus.
  const scored = preferredTags.length
    ? candidates.map((video) => withTagAffinity(video, preferredTags))
    : candidates;

  const ranked = rerank(scored, { limit: safeLimit });

  // `rankingBonus` is an internal scoring crutch. Strip it before the videos
  // leave the service so the API keeps exposing real engagement counts only.
  return ranked.slice(0, safeLimit).map(({ rankingBonus, ...video }) => video);
}

// Tag overlap becomes an extra engagement-equivalent score. It is additive in
// the same units as `likes`, so a strong topical match can outweigh a modest
// engagement gap without being able to override it entirely.
function withTagAffinity(video, preferredTags) {
  const tags = video.tags ?? [];
  const matches = tags.filter((tag) => preferredTags.includes(tag)).length;
  if (matches === 0) return video;

  return {
    ...video,
    // Kept in its own field rather than folded into `likes`: the ranker reads
    // it as an extra like-equivalent signal, but the API must keep reporting
    // the real like count or the UI shows a fractional number.
    rankingBonus: (TAG_BONUS / env.feedWeights.like) * matches,
  };
}

async function getPreferredTags(userId) {
  if (!userId) return [];

  const events = await WatchEvent.find({
    userId,
    watchDuration: { $gte: MIN_WATCH_SECONDS },
    completionRate: { $gte: MIN_COMPLETION_RATE },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('videoId', 'tags');

  const counts = new Map();
  for (const event of events) {
    for (const tag of event.videoId?.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  // Most-watched topics first; ties fall back to alphabetical so the ranking
  // is reproducible.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([tag]) => tag);
}

async function getRecentlyWatchedVideoIds(userId, limit = 200) {
  if (!userId) return [];

  const events = await WatchEvent.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('videoId');

  return events.map((e) => e.videoId).filter(Boolean);
}

// Explicit negative signals. These are the "not interested" and "hide this
// creator" controls, which a ranking system needs as much as positive ones:
// without them the only way to escape a topic is to stop using the app.
async function getHiddenCreatorIds(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select('feedPreferences.hiddenCreators');
  return (user?.feedPreferences?.hiddenCreators ?? []).map(
    (id) => new mongoose.Types.ObjectId(id)
  );
}

async function getHiddenTags(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select('feedPreferences.hiddenTags');
  return user?.feedPreferences?.hiddenTags ?? [];
}

// Creadores que este usuario no debe ver en el feed: los que bloqueó **y**
// los que le bloquearon a él. El bloqueo es mutuo en el resto de la app (el
// chat y las llamadas lo aplican en las dos direcciones), así que el feed no
// puede ser el único sitio donde una de las dos partes sigue viendo a la otra:
// quien bloquea espera desaparecer también del otro lado.
async function getBlockedCreatorIds(userId) {
  if (!userId) return [];
  const [user, blockedBy] = await Promise.all([
    User.findById(userId).select('blockedUsers'),
    User.find({ blockedUsers: userId }).select('_id'),
  ]);
  const ids = [
    ...(user?.blockedUsers ?? []).map((id) => String(id)),
    ...blockedBy.map((u) => String(u._id)),
  ];
  return [...new Set(ids)];
}

// Whether a viewer may be shown adult content. Anonymous visitors and anyone
// who has not passed age verification are excluded. Exposed so the single-video
// endpoint can apply the same rule instead of re-deriving it.
async function canViewAdultContent(userId) {
  if (!userId) return false;
  const user = await User.findById(userId).select('ageVerification.status');
  return user?.ageVerification?.status === 'verified';
}

module.exports = {
  getForYouFeed,
  getPreferredTags,
  getRecentlyWatchedVideoIds,
  getHiddenCreatorIds,
  getHiddenTags,
  getBlockedCreatorIds,
  canViewAdultContent,
  MIN_WATCH_SECONDS,
  MIN_COMPLETION_RATE,
};
