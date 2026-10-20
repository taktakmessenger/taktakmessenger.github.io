const mongoose = require('mongoose');

// A gift is a priced reaction. The coin cost lives here, never in the request
// body, so the price of a "Cohete" cannot be edited by whoever sends it.
const giftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    coinCost: { type: Number, required: true, min: 1 },
    iconUrl: { type: String, required: true },
    animationUrl: String,
    category: {
      type: String,
      enum: ['popular', 'intermediate', 'premium', 'legendary'],
      default: 'popular',
    },
    isFullScreen: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

giftSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('Gift', giftSchema);
