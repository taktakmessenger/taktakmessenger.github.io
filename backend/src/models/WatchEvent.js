const mongoose = require('mongoose');

// One row per playback session. The recommendation engine reads these to learn
// which topics actually hold a viewer's attention, rather than trusting raw
// view counts.
const watchEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
      index: true,
    },
    watchDuration: { type: Number, required: true, min: 0 },
    videoDuration: { type: Number, required: true, min: 0 },
    completed: { type: Boolean, default: false },
    replayed: { type: Boolean, default: false },
    // Fraction of the video watched, stored so the feed can index on it
    // directly instead of recomputing the ratio on every query.
    completionRate: { type: Number, default: 0, min: 0, max: 1 },
  },
  { timestamps: true }
);

watchEventSchema.index({ userId: 1, createdAt: -1 });
watchEventSchema.index({ videoId: 1, createdAt: -1 });

// Clamp the stored ratio so a client cannot report a >100% completion rate.
watchEventSchema.pre('save', function clampCompletion(next) {
  if (this.videoDuration > 0) {
    this.completionRate = Math.min(1, this.watchDuration / this.videoDuration);
    this.completed = this.completionRate >= 0.9;
  }
  next();
});

module.exports = mongoose.model('WatchEvent', watchEventSchema);
