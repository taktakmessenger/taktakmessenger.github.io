const mongoose = require('mongoose');

// A conversation is the container for messages between people. It is a separate
// document rather than just a `conversationId` string on each message so the
// inbox can be listed with one query and so group chats (more than two
// participants) can be added later without migrating message history.
//
// `type` is stored now even though only 'direct' is implemented: it is the field
// that decides whether a deterministic key applies, and adding it after the
// fact would mean rewriting every existing conversation.
const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['direct', 'group'], default: 'direct' },

    // Only for direct conversations. Derived from the two participant ids in a
    // fixed order, so "start a chat with X" always resolves to the same document
    // no matter who opens it. Without this, both users tapping "message" at the
    // same time would create two parallel threads and split the history.
    key: { type: String, unique: true, sparse: true },

    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2,
        message: 'Una conversación necesita al menos dos participantes',
      },
    },

    // Denormalised for the inbox list. Listing conversations sorted by activity
    // would otherwise need a lookup into every conversation's newest message.
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: '', maxlength: 140 },

    // Per-participant unread counter, keyed by user id. Kept as a Map so the
    // inbox can show a badge per conversation without counting messages.
    unread: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

// Inbox query: my conversations, most recently active first.
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

// Builds the deterministic key for a direct conversation. Sorting the ids means
// (A,B) and (B,A) produce the same key.
conversationSchema.statics.directKey = function directKey(userA, userB) {
  return [String(userA), String(userB)].sort().join(':');
};

conversationSchema.methods.hasParticipant = function hasParticipant(userId) {
  return this.participants.some((p) => String(p._id || p) === String(userId));
};

module.exports = mongoose.model('Conversation', conversationSchema);
