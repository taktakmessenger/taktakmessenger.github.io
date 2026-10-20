const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Video = require('../models/Video');
const User = require('../models/User');
const feedService = require('./feedService');
const { HttpError } = require('../utils/http');

// A comment must never reveal more than the video does. If a viewer cannot see
// the video, the thread does not exist for them either; otherwise the comment
// endpoint would become a way to read captions and discussions of restricted
// content. Throws the same 404 the video route uses, so nothing is confirmed.
async function assertVideoVisible(videoId, viewerId) {
  if (!mongoose.isValidObjectId(videoId)) {
    throw new HttpError(404, 'Video no encontrado');
  }

  const video = await Video.findById(videoId).select('isNSFW creator moderationStatus');
  if (!video || video.moderationStatus === 'rejected') {
    throw new HttpError(404, 'Video no encontrado');
  }

  const isOwner = String(video.creator) === String(viewerId);
  if (video.isNSFW && !isOwner) {
    if (!(await feedService.canViewAdultContent(viewerId))) {
      throw new HttpError(404, 'Video no encontrado');
    }
  }

  return video;
}

// Comments are public read: an anonymous visitor can read a thread on public
// content, matching the video itself. Writing always needs a session.
async function listComments({ videoId, viewerId, cursor, limit = 20 }) {
  await assertVideoVisible(videoId, viewerId);

  const filter = { video: videoId, parent: null };
  if (cursor) {
    filter.createdAt = { $lt: new Date(cursor) };
  }

  const comments = await Comment.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('author', 'username profile.displayName profile.avatar');

  const nextCursor =
    comments.length === limit ? comments[comments.length - 1].createdAt : null;

  return { comments: comments.map(toPublic), nextCursor };
}

async function listReplies({ commentId, viewerId, limit = 20 }) {
  const parent = await Comment.findById(commentId).select('video');
  if (!parent) throw new HttpError(404, 'Comentario no encontrado');
  await assertVideoVisible(parent.video, viewerId);

  const replies = await Comment.find({ parent: commentId })
    .sort({ createdAt: 1 })
    .limit(limit)
    .populate('author', 'username profile.displayName profile.avatar');

  return { replies: replies.map(toPublic) };
}

// `parentId` is accepted so a reply can be created in one call. The parent is
// validated here rather than in the route so the reply can never be attached to
// a comment belonging to a different video.
async function createComment({ videoId, authorId, text, parentId }) {
  await assertVideoVisible(videoId, authorId);

  const clean = String(text || '').trim();
  if (!clean) throw new HttpError(400, 'El comentario no puede estar vacío');

  let parent = null;
  if (parentId) {
    if (!mongoose.isValidObjectId(parentId)) {
      throw new HttpError(400, 'Comentario padre inválido');
    }
    parent = await Comment.findById(parentId).select('video parent');
    if (!parent) throw new HttpError(404, 'Comentario padre no encontrado');
    // The parent must belong to the same video. Without this check a reply
    // could be filed under an unrelated thread and appear in the wrong video.
    if (String(parent.video) !== String(videoId)) {
      throw new HttpError(400, 'El comentario padre pertenece a otro video');
    }
    // Replies are one level deep: replying to a reply attaches to its
    // top-level ancestor, which is what the UI shows.
    if (parent.parent) {
      parent = await Comment.findById(parent.parent).select('video parent');
    }
  }

  const comment = await Comment.create({
    video: videoId,
    author: authorId,
    text: clean,
    parent: parent?._id || null,
  });

  // The video's counter is the number of visible comments. It is incremented
  // only for a top-level comment: a reply is not a separate line in the
  // counter the feed displays, matching what the UI counts.
  if (!parent) {
    await Video.updateOne({ _id: videoId }, { $inc: { comments: 1 } });
  } else {
    await Comment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });
  }

  await comment.populate('author', 'username profile.displayName profile.avatar');
  return toPublic(comment);
}

// Only the author or an administrator may delete. Enforced here, not only in
// the UI: hiding the button does not stop a direct request.
async function deleteComment({ commentId, actorId, actorRole }) {
  if (!mongoose.isValidObjectId(commentId)) {
    throw new HttpError(404, 'Comentario no encontrado');
  }

  const comment = await Comment.findById(commentId);
  if (!comment || comment.deletedAt) {
    throw new HttpError(404, 'Comentario no encontrado');
  }

  const isAuthor = String(comment.author) === String(actorId);
  if (!isAuthor && actorRole !== 'admin') {
    throw new HttpError(403, 'No puedes eliminar este comentario');
  }

  // Soft delete: the row stays so replies do not lose their place, but the text
  // is cleared and the author is kept for audit. Written with an update rather
  // than `save()` on purpose: `text` is `required`, so saving an emptied
  // document would fail validation. Validation still guards creation, where it
  // matters.
  await Comment.updateOne(
    { _id: comment._id },
    { $set: { deletedAt: new Date(), deletedBy: actorId, text: '' } }
  );

  if (!comment.parent) {
    await Video.updateOne({ _id: comment.video }, { $inc: { comments: -1 } });
  } else {
    await Comment.updateOne({ _id: comment.parent }, { $inc: { replyCount: -1 } });
  }

  return { deleted: true };
}

// Like toggle on a comment, mirroring the video like endpoint: the `likedBy`
// set is the source of truth so repeated taps cannot inflate the counter.
async function toggleLike({ commentId, userId }) {
  if (!mongoose.isValidObjectId(commentId)) {
    throw new HttpError(404, 'Comentario no encontrado');
  }

  const liked = await Comment.findOneAndUpdate(
    { _id: commentId, likedBy: { $ne: userId }, deletedAt: null },
    { $addToSet: { likedBy: userId }, $inc: { likes: 1 } },
    { new: true }
  );
  if (liked) return { likes: liked.likes, liked: true };

  const unliked = await Comment.findOneAndUpdate(
    { _id: commentId, likedBy: userId },
    { $pull: { likedBy: userId }, $inc: { likes: -1 } },
    { new: true }
  );
  if (!unliked) throw new HttpError(404, 'Comentario no encontrado');

  return { likes: unliked.likes, liked: false };
}

// Shape sent to the client. A deleted comment keeps its position and its
// replies but exposes no text and no author, so a removed message cannot be
// read back through the API.
function toPublic(comment) {
  const doc = comment.toObject ? comment.toObject() : comment;
  const deleted = Boolean(doc.deletedAt);

  return {
    _id: doc._id,
    video: doc.video,
    parent: doc.parent,
    text: deleted ? '' : doc.text,
    deleted,
    likes: doc.likes,
    replyCount: doc.replyCount,
    createdAt: doc.createdAt,
    author: deleted
      ? null
      : doc.author && typeof doc.author === 'object' && doc.author.username
        ? {
            _id: doc.author._id,
            username: doc.author.username,
            displayName: doc.author.profile?.displayName || null,
            avatar: doc.author.profile?.avatar || null,
          }
        : doc.author,
  };
}

// Whether a given user wrote a comment, used to decide if the delete control
// should be offered. The server still enforces the rule on delete.
async function canDelete(comment, actorId, actorRole) {
  if (actorRole === 'admin') return true;
  return String(comment.author) === String(actorId);
}

// The author of a comment, for the report flow and for notifications.
async function authorOf(commentId) {
  const comment = await Comment.findById(commentId).select('author video');
  if (!comment) throw new HttpError(404, 'Comentario no encontrado');
  return comment;
}

// Used when a video is removed: its comments go with it, so a deleted video
// leaves no readable thread behind.
async function removeForVideo(videoId) {
  await Comment.updateMany(
    { video: videoId, deletedAt: null },
    { $set: { deletedAt: new Date(), text: '' } }
  );
}

module.exports = {
  listComments,
  listReplies,
  createComment,
  deleteComment,
  toggleLike,
  assertVideoVisible,
  canDelete,
  authorOf,
  removeForVideo,
  toPublic,
};
