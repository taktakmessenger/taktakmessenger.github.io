const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeValueScore,
  computeDecay,
  computeColdStart,
  rerank,
} = require('../src/services/rankingService');

// A fixed "now" keeps these assertions stable instead of drifting with the
// wall clock.
const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3_600_000);

function video(overrides = {}) {
  return {
    _id: String(Math.random()).slice(2, 12),
    createdAt: hoursAgo(1),
    likes: 0,
    comments: 0,
    shares: 0,
    gifts: 0,
    views: 0,
    completions: 0,
    impressions: 0,
    ...overrides,
  };
}

test('decay halves the score after one half-life', () => {
  const halfLife = 24;
  assert.equal(computeDecay(0, halfLife), 1);
  assert.equal(computeDecay(halfLife, halfLife), 0.5);
  assert.equal(computeDecay(halfLife * 2, halfLife), 0.25);
});

test('decay is disabled rather than crashing on a bad half-life', () => {
  assert.equal(computeDecay(10, 0), 1);
  assert.equal(computeDecay(10, -5), 1);
});

test('a share outranks a like, because the weights say so', () => {
  const liked = video({ likes: 10 });
  const shared = video({ shares: 10 });
  assert.ok(computeValueScore(shared) > computeValueScore(liked));
});

// The defining property of log compression: each doubling of a count adds a
// constant amount, whatever the base. A linear model would add 1000 for the
// first doubling and 1,000,000 for a later one, which is how a single viral
// clip buries everything else.
test('engagement grows logarithmically, not linearly', () => {
  const score = (views) => computeValueScore(video({ views }));

  // Two doublings at very different scales.
  const smallJump = score(2000) - score(1000);
  const largeJump = score(4000) - score(2000);

  // log1p is not exactly scale-free, so allow a small tolerance.
  assert.ok(
    Math.abs(smallJump - largeJump) < 0.01,
    `duplicar debe sumar casi lo mismo (${smallJump} vs ${largeJump})`
  );

  // A linear model would make the million-view clip dominate by orders of
  // magnitude; here the ratio stays tiny.
  const linear = (1_000_000 - 100) / (10_000 - 100);
  assert.ok((score(1_000_000) - score(100)) / (score(10_000) - score(100)) < linear / 50);
});

test('a fresh video beats an identical older one', () => {
  const fresh = video({ likes: 100, createdAt: hoursAgo(1) });
  const old = video({ likes: 100, createdAt: hoursAgo(24 * 14) });
  assert.ok(computeValueScore(fresh) > computeValueScore(old));
});

// The cold-start boost must actually help a new video with no engagement.
test('a brand-new video with no engagement can outrank a stale popular one', () => {
  const brandNew = video({ createdAt: hoursAgo(0.1) });
  const stalePopular = video({ likes: 50, views: 500, createdAt: hoursAgo(24 * 30) });
  assert.ok(computeValueScore(brandNew) > computeValueScore(stalePopular));
});

test('the cold-start boost fades as the video ages', () => {
  const opts = { coldStartHours: 6, explorationBonus: 0.6, impressionFloor: 200 };
  assert.ok(computeColdStart(0, 0, opts) > computeColdStart(3, 0, opts));
  assert.equal(computeColdStart(6, 0, opts), 1);
  assert.equal(computeColdStart(10, 0, opts), 1);
});

// Once a new video has been seen by enough people, pushing it further is waste.
test('an already-exposed video gets no exploration boost', () => {
  const opts = { coldStartHours: 6, explorationBonus: 0.6, impressionFloor: 200 };
  assert.equal(computeColdStart(1, 500, opts), 1);
});

test('rerank caps how many videos one creator takes in a page', () => {
  const prolific = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  // Enough distinct creators to fill the page, plus one account that would
  // otherwise sweep it on engagement alone.
  const candidates = [
    ...Array.from({ length: 10 }, (_, i) =>
      video({ creator: prolific, likes: 500 - i, createdAt: hoursAgo(1) })
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      video({ creator: `other-${i}`, likes: 10 - i, createdAt: hoursAgo(1) })
    ),
  ];

  const ranked = rerank(candidates, { limit: 5, maxPerCreator: 2 });
  assert.equal(ranked.length, 5);

  const fromProlific = ranked.filter((v) => v.creator === prolific).length;
  assert.equal(fromProlific, 2, 'un creador no debe ocupar la página entera');
});

// A page may come back short rather than let one account own it. Filling the
// remainder from the overflow is exactly the bug the cap exists to prevent.
test('rerank returns a short page rather than exceed the per-creator cap', () => {
  const creator = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const candidates = Array.from({ length: 5 }, (_, i) => video({ creator, likes: 100 - i }));

  const ranked = rerank(candidates, { limit: 5, maxPerCreator: 2 });
  assert.equal(ranked.length, 2, 'la página se acorta en vez de repetir creador');
});

test('rerank spreads a page across many creators', () => {
  const candidates = [];
  for (let c = 0; c < 6; c += 1) {
    for (let i = 0; i < 3; i += 1) {
      candidates.push(video({ creator: `creator-${c}`, likes: 50 - i }));
    }
  }

  const ranked = rerank(candidates, { limit: 6, maxPerCreator: 2 });
  const distinct = new Set(ranked.map((v) => v.creator));
  assert.ok(distinct.size >= 3, 'la primera página debe variar de creador');
});

test('rerank is deterministic for equal scores', () => {
  const candidates = [
    video({ likes: 10, createdAt: hoursAgo(5), _id: 'aaa' }),
    video({ likes: 10, createdAt: hoursAgo(5), _id: 'bbb' }),
    video({ likes: 10, createdAt: hoursAgo(5), _id: 'ccc' }),
  ];

  const first = rerank(candidates, { limit: 3 }).map((v) => v._id);
  const second = rerank([...candidates].reverse(), { limit: 3 }).map((v) => v._id);
  assert.deepEqual(first, second, 'el orden debe ser estable entre llamadas');
});

test('a video with no engagement still has a non-zero score', () => {
  assert.ok(computeValueScore(video({ createdAt: hoursAgo(48 * 5) })) > 0);
});
