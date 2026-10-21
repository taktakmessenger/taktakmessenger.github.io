const env = require('../config/env');

// Ranking model, adapted from the architecture ByteDance published for its
// recommender (Monolith, ACM RecSys 2022) and from TikTok's public "For You"
// description. Three ideas are reproduced here because they are the ones the
// previous feed lacked:
//
//  1. Multi-objective value function. A single `sort({views:-1})` optimises one
//     signal, which is how a feed turns into a clickbait engine. Each signal is
//     scored separately and combined with an explicit weight, so a like, a
//     share and a paid gift are worth different amounts on purpose.
//  2. Recency decay. Popularity is multiplied by an exponential half-life so a
//     video from last year cannot outrank something from this morning.
//  3. Tiered cold start. A fresh clip gets a temporary exploration boost so it
//     can reach a test audience; the boost fades with age and exposure, which
//     is the "distribute to a small audience first" step described publicly.
//
// Counts are compressed with ln(1+x). Without it a single viral video with a
// million views would flatten every other candidate to zero.

// Sum of log-compressed engagement, each signal weighted independently.
function computeEngagement(video, weights) {
  const signal = (count, weight) => weight * Math.log1p(Math.max(0, count || 0));

  return (
    // Tag affinity rides along as extra like-equivalents. It is additive in the
    // same units as `likes`, so a strong topical match can outweigh a modest
    // engagement gap without being able to override it entirely.
    signal((video.likes || 0) + (video.rankingBonus || 0), weights.like) +
    signal(video.comments, weights.comment) +
    signal(video.shares, weights.share) +
    signal(video.gifts, weights.gift) +
    signal(video.views, weights.view) +
    signal(video.completions, weights.complete)
  );
}

// 0.5 ** (age / halfLife): halves the weight of a video every `halfLifeHours`.
function computeDecay(ageHours, halfLifeHours) {
  if (!(halfLifeHours > 0)) return 1;
  return 0.5 ** (ageHours / halfLifeHours);
}

// The exploration boost applies only while a video is both new and still
// under-exposed. A new clip that already reached many viewers does not need to
// be pushed further.
function computeColdStart(ageHours, impressions, opts) {
  const { coldStartHours, explorationBonus, impressionFloor } = opts;
  if (!(coldStartHours > 0) || ageHours >= coldStartHours) return 1;
  if (impressions >= impressionFloor) return 1;

  // Linear fade to 1 across the cold-start window.
  return 1 + explorationBonus * (1 - ageHours / coldStartHours);
}

/**
 * Final ranking value for one candidate.
 *
 * Exported so the model can be unit-tested directly, and used as the single
 * source of truth for ranking: the Mongo query only pre-filters and orders the
 * candidate pool, it never re-implements this formula.
 */
function computeValueScore(video, options = {}) {
  const weights = options.weights ?? env.feedWeights;
  const halfLifeHours = options.halfLifeHours ?? env.feedHalfLifeHours;
  const createdAt = video.createdAt ? new Date(video.createdAt).getTime() : Date.now();
  const ageHours = Math.max(0, (Date.now() - createdAt) / 3_600_000);

  const engagement = computeEngagement(video, weights);
  const decay = computeDecay(ageHours, halfLifeHours);
  const coldStart = computeColdStart(ageHours, video.impressions || 0, {
    coldStartHours: options.coldStartHours ?? env.feedColdStartHours,
    explorationBonus: options.explorationBonus ?? env.feedExplorationBonus,
    impressionFloor: options.impressionFloor ?? env.feedImpressionFloor,
  });

  // +1 keeps a brand-new video with no engagement at a non-zero score, so the
  // cold-start boost can still lift it above stale content.
  return (1 + engagement) * decay * coldStart;
}

/**
 * Re-rank a candidate pool and spread it across creators.
 *
 * Without this cap, one prolific account can occupy an entire page: its videos
 * all share the same tag affinity and engagement profile, so they score
 * similarly and cluster at the top.
 *
 * The cap is strict: a page may come back shorter than `limit` when few
 * creators exist. Filling the remainder from the overflow would defeat the cap
 * entirely, which is the bug this function exists to prevent. A short page is
 * honest; a page that is 100% one account is not.
 */
function rerank(candidates, { limit, maxPerCreator = env.feedMaxPerCreator, weights, halfLifeHours } = {}) {
  const scored = candidates
    .map((video) => ({ video, score: computeValueScore(video, { weights, halfLifeHours }) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break keeps pagination stable between requests.
      const at = new Date(a.video.createdAt || 0).getTime();
      const bt = new Date(b.video.createdAt || 0).getTime();
      if (bt !== at) return bt - at;
      return String(b.video._id).localeCompare(String(a.video._id));
    });

  const selected = [];
  const perCreator = new Map();

  for (const entry of scored) {
    if (selected.length >= limit) break;
    const creatorId = String(entry.video.creator?._id ?? entry.video.creator ?? '');
    const used = perCreator.get(creatorId) ?? 0;
    if (used >= maxPerCreator) continue;

    perCreator.set(creatorId, used + 1);
    selected.push(entry.video);
  }

  return selected;
}

module.exports = {
  computeValueScore,
  computeEngagement,
  computeDecay,
  computeColdStart,
  rerank,
};
