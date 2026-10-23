const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    amount: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      // `gift` and `gift_bonus` are the two faces of a gift: the paid path
      // credits withdrawable Diamonds, the promotional path credits spend-only
      // coins. Keeping them apart is what makes the money trail auditable.
      enum: [
        'gift',
        'gift_bonus',
        'withdraw',
        'purchase',
        'convert',
        'platform',
        'platform_bonus',
        'bonus',
      ],
      required: true,
    },
    ttcType: { type: String, enum: ['ttcC', 'ttcR'], default: 'ttcC' },

    // Only populated for gifts: how the amount was split.
    creatorAmount: Number,
    platformAmount: Number,
    giftName: { type: String, trim: true, maxlength: 40 },
    // Catalogue entry the gift came from. Present for gifts priced server-side.
    giftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gift' },

    // Only populated for purchases: what the buyer actually paid.
    amountPaid: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3 },
    packageId: String,
    // Idempotency key from the payment provider. A unique index on this makes
    // replaying the same webhook a no-op instead of a double credit.
    externalId: { type: String, index: { unique: true, sparse: true } },

    // Context / payout metadata.
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    method: String,
    details: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'completed',
    },
  },
  { timestamps: true }
);

transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ from: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
