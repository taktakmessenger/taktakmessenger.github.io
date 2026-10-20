const mongoose = require('mongoose');

// A comment is its own document rather than an array inside Video. An array
// would grow without bound, force every video read to load the whole thread,
// and make pagination impossible without reading the lot first.
const commentSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    // Replies are one level deep. `parent` is null for a top-level comment;
    // nesting further would need a tree and a different UI, so a reply always
    // points at a top-level comment.
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
      index: true,
    },
    // Denormalised so a thread can render its reply count without an aggregate
    // over the whole collection on every page load.
    replyCount: { type: Number, default: 0, min: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    likes: { type: Number, default: 0, min: 0 },
    // Soft delete. A reply keeps its parent visible context, and a moderator
    // needs to see that something was removed rather than have the thread
    // silently renumber.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// The thread query: top-level comments of one video, newest first.
commentSchema.index({ video: 1, parent: 1, createdAt: -1 });
// Replies of one parent.
commentSchema.index({ parent: 1, createdAt: 1 });

commentSchema.methods.isDeleted = function isDeleted() {
  return Boolean(this.deletedAt);
};

module.exports = mongoose.model('Comment', commentSchema);
