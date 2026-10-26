const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 500 },
    videoUrl: { type: String, required: true },
    // Set once the HLS ladder finishes. Clients prefer this over videoUrl for
    // adaptive playback; videoUrl stays as the downloadable original.
    hlsUrl: String,
    thumbnailUrl: String,
    duration: { type: Number, min: 0 },
    tags: [{ type: String, trim: true, maxlength: 30 }],
    isNSFW: { type: Boolean, default: false },
    isLive: { type: Boolean, default: false },

    // The track this video was recorded against, if any.
    sound: { type: mongoose.Schema.Types.ObjectId, ref: 'Sound' },
    // Upload lifecycle: an original is playable immediately, then the HLS
    // ladder is produced in the background.
    transcodeStatus: {
      type: String,
      enum: ['none', 'processing', 'ready', 'failed'],
      default: 'none',
    },
    transcodeError: String,

    views: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    // One entry per user who liked. `$addToSet`/`$pull` on this set make the
    // like counter idempotent; without it a double-click inflated `likes`.
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: { type: Number, default: 0, min: 0 },
    // Compartidos. Antes este campo existía y la barra de acciones lo mostraba,
    // pero **nada lo incrementaba**: siempre marcaba 0 y el ranking le daba un
    // peso (el mayor de todos) a una señal que nunca llegaba.
    //
    // `sharedBy` lo hace idempotente por persona, como `likedBy`: compartir el
    // mismo vídeo cinco veces no lo hace cinco veces más relevante. Se pierde
    // contar un segundo envío a otro amigo, pero a cambio el número no se puede
    // inflar a mano, que es lo que importa cuando alimenta el ranking.
    shares: { type: Number, default: 0, min: 0 },
    sharedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Descargas concedidas. Cuenta cuánta gente se llevó el archivo, que es una
    // señal de interés distinta del "me gusta" o de la vista.
    downloads: { type: Number, default: 0, min: 0 },
    gifts: { type: Number, default: 0, min: 0 },

    ttcEarned: { type: Number, default: 0, min: 0 },

    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    moderationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
    },
    moderatedAt: Date,
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // News attribution. A creator may *claim* a source and link to the original
    // reporting, but `newsVerified` is granted only by an administrator. If the
    // claim alone were enough to show the badge, an account could borrow a real
    // newsroom's credibility by naming it, which is the exact failure mode the
    // badge is supposed to prevent.
    newsSource: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsSource', default: null },
    sourceUrl: { type: String, trim: true, maxlength: 500 },
    newsVerified: { type: Boolean, default: false },
    newsVerifiedAt: { type: Date, default: null },
    newsVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

videoSchema.index({ createdAt: -1 });
videoSchema.index({ views: -1 });
videoSchema.index({ moderationStatus: 1, createdAt: -1 });
// The For You ranking filters on approved content ordered by popularity.
videoSchema.index({ moderationStatus: 1, views: -1, likes: -1 });

module.exports = mongoose.model('Video', videoSchema);
