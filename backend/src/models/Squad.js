const mongoose = require('mongoose');

// A TAK Squad is a creator's private sub-community. It is the answer to the
// TikTok pain point where a creator's only channel to their audience is the
// public comment section.
const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'moderator', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const squadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 50 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 300 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'private' },
    // Required to join a private squad. Never returned by the list endpoint.
    joinCode: { type: String, select: false },
    members: [memberSchema],
    // Voice rooms are a room name clients connect to over the live websocket.
    voiceRoom: { type: String },
  },
  { timestamps: true }
);

squadSchema.index({ visibility: 1, createdAt: -1 });

squadSchema.methods.isMember = function isMember(userId) {
  return this.members.some((m) => m.user.toString() === String(userId));
};

squadSchema.methods.isOwner = function isOwner(userId) {
  return this.owner.toString() === String(userId);
};

module.exports = mongoose.model('Squad', squadSchema);
