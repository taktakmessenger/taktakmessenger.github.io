const User = require('../models/User');
const Video = require('../models/Video');
const Transaction = require('../models/Transaction');
const env = require('../config/env');
const { round2 } = require('./walletService');

// Weights that turn raw engagement into "points" for reward allocation.
const POINTS = {
  view: 0.1,
  like: 2,
  comment: 5,
  share: 10,
  gift: 20,
};
// Fresh content is worth double within its first hour.
const FRESH_CONTENT_BONUS = 2;
const FRESH_CONTENT_WINDOW_MS = 60 * 60 * 1000;

class MiningService {
  constructor() {
    this.isRunning = false;
    this.timer = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.distributeRewards().catch((err) =>
        console.error('[mining] error en ciclo:', err)
      );
    }, env.miningIntervalMs);
    // Do not keep the event loop alive solely for the mining timer.
    this.timer.unref?.();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  scoreVideo(video, now = Date.now()) {
    let points =
      video.views * POINTS.view +
      video.likes * POINTS.like +
      video.comments * POINTS.comment +
      video.shares * POINTS.share +
      video.gifts * POINTS.gift;

    if (now - new Date(video.createdAt).getTime() < FRESH_CONTENT_WINDOW_MS) {
      points *= FRESH_CONTENT_BONUS;
    }
    return points;
  }

  /**
   * Distribute one cycle of the reward pool to creators, weighted by the
   * engagement score of their approved videos.
   *
   * The prototype computed a per-user reward and issued a separate
   * read-modify-write per user, which loses updates under concurrency. Here the
   * payout is a single `$inc` per user, which is atomic.
   */
  async distributeRewards(now = Date.now()) {
    const windowStart = new Date(now - env.miningIntervalMs);

    const videos = await Video.find({
      createdAt: { $gte: windowStart },
      moderationStatus: 'approved',
    }).select('creator views likes comments shares gifts createdAt');

    if (videos.length === 0) {
      return { distributed: 0, recipients: 0 };
    }

    const pointsByCreator = new Map();
    let totalPoints = 0;
    for (const video of videos) {
      const points = this.scoreVideo(video, now);
      if (points <= 0) continue;
      const key = video.creator.toString();
      pointsByCreator.set(key, (pointsByCreator.get(key) || 0) + points);
      totalPoints += points;
    }

    if (totalPoints <= 0) {
      return { distributed: 0, recipients: 0 };
    }

    const creatorPool = env.miningRewardPool * 0.36;
    let distributed = 0;

    for (const [creatorId, points] of pointsByCreator) {
      const reward = round2((points / totalPoints) * creatorPool);
      if (reward <= 0) continue;

      await User.updateOne({ _id: creatorId }, { $inc: { 'wallet.ttcR': reward } });
      await Transaction.create({
        from: creatorId,
        to: creatorId,
        amount: reward,
        type: 'mining',
        ttcType: 'ttcR',
        status: 'completed',
        details: 'Recompensa de minado por engagement',
      });
      distributed += reward;
    }

    return {
      distributed: round2(distributed),
      recipients: pointsByCreator.size,
    };
  }
}

module.exports = new MiningService();
module.exports.MiningService = MiningService;
