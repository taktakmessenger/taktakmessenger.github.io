const mongoose = require('mongoose');

// A news organisation that has been vetted by an administrator.
//
// The problem this solves: a platform where anyone can post has no way to
// distinguish a clip from a real newsroom from one that merely claims to be
// news. A self-applied "news" label is worth nothing — it is exactly what a
// disinformation account would use. So the badge is not a property a creator
// sets; it is granted to a *source*, once, by a human reviewer, and only then
// can content be attributed to it.
const newsSourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Domains the organisation is known to publish on. Used to check that a
    // link actually points at the source it claims, rather than at a lookalike
    // domain set up to borrow its credibility.
    domains: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
    // Where the vetting evidence lives (press registry, editorial contact
    // confirmation). Kept so a decision can be audited later.
    evidenceUrl: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'verified', 'revoked'],
      default: 'pending',
      index: true,
    },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// A name is unique so two rows cannot both claim to be the same outlet, which
// would make "which one is the real badge" ambiguous.
newsSourceSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('NewsSource', newsSourceSchema);
