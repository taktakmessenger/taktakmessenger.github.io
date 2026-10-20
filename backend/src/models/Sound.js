const mongoose = require('mongoose');

// A reusable audio track. Clipping a sound from a video is how trends spread:
// every new video that uses it links back to the original.
const soundSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    artist: { type: String, default: 'Sonido original', trim: true, maxlength: 60 },
    audioUrl: { type: String, required: true },
    duration: { type: Number, min: 0 },
    usageCount: { type: Number, default: 0, min: 0 },
    originalVideo: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

soundSchema.index({ usageCount: -1, createdAt: -1 });

module.exports = mongoose.model('Sound', soundSchema);
