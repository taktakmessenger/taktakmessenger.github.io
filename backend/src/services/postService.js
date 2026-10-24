const mongoose = require('mongoose');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const notificationService = require('../services/notificationService');
const { HttpError } = require('../utils/http');

const PAGE_SIZE = 20;

// Forma pública de un autor, aplanada para que la pantalla no navegue el
// documento de Mongoose. Se devuelve siempre el mismo bloque venga el autor
// poblado o no, porque un `_id` suelto rompería el render de la tarjeta.
function publicAuthor(author) {
  if (!author || typeof author !== 'object' || !author.username) return author;
  return {
    _id: author._id,
    username: author.username,
    displayName: author.profile?.displayName || null,
    avatar: author.profile?.avatar || null,
    isVerified: Boolean(author.profile?.isVerified),
  };
}

// Un comentario borrado conserva su hueco pero no expone ni texto ni autor, para
// que lo retirado no se pueda leer de vuelta por la API.
function publicComment(comment) {
  const doc = comment.toObject ? comment.toObject() : comment;
  const deleted = Boolean(doc.deletedAt);
  return {
    _id: doc._id,
    post: doc.post,
    text: deleted ? '' : doc.text,
    deleted,
    likes: doc.likes,
    createdAt: doc.createdAt,
    author: deleted ? null : publicAuthor(doc.author),
  };
}

// Una publicación no visible (borrada o retirada) no existe para quien no la
// administra. Se responde el mismo 404 que si nunca hubiera estado, para no
// confirmar que hubo algo.
function assertVisible(post) {
  if (!post || !post.isVisible()) {
    throw new HttpError(404, 'Publicación no encontrada');
  }
}

// Muro general: las publicaciones visibles, de la más nueva a la más vieja,
// paginadas por `createdAt` (keyset). `viewerId` decide el campo `liked` de
// cada entrada sin una consulta extra por publicación.
async function listFeed({ viewerId, cursor, limit = PAGE_SIZE, authorId } = {}) {
  const filter = { deletedAt: null, hiddenAt: null };
  if (authorId) {
    if (!mongoose.isValidObjectId(authorId)) {
      throw new HttpError(400, 'Autor inválido');
    }
    filter.author = authorId;
  }
  if (cursor) {
    filter.createdAt = { $lt: new Date(cursor) };
  }

  const posts = await Post.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('author', 'username profile.displayName profile.avatar profile.isVerified');

  const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt : null;

  return {
    posts: posts.map((post) => serializePost(post, viewerId)),
    nextCursor,
  };
}

async function getPost({ postId, viewerId }) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new HttpError(404, 'Publicación no encontrada');
  }
  const post = await Post.findById(postId).populate(
    'author',
    'username profile.displayName profile.avatar profile.isVerified'
  );
  assertVisible(post);
  return serializePost(post, viewerId);
}

// Crea una publicación. Exige al menos texto o un adjunto: una entrada vacía no
// aporta nada y llenaría el muro de huecos.
async function createPost({ authorId, text, attachment }) {
  const clean = String(text || '').trim();
  if (!clean && !attachment) {
    throw new HttpError(400, 'Escribe algo o adjunta una imagen o un vídeo');
  }

  if (attachment) {
    // El adjunto debe venir de nuestra propia subida, igual que en el chat: si
    // no, se podría incrustar una URL externa arbitraria en el muro.
    if (!String(attachment.url || '').startsWith('/uploads/wall/')) {
      throw new HttpError(400, 'Adjunto inválido');
    }
    if (!['image', 'video'].includes(attachment.kind)) {
      throw new HttpError(400, 'Adjunto inválido');
    }
  }

  const post = await Post.create({
    author: authorId,
    text: clean,
    attachment: attachment
      ? {
          kind: attachment.kind,
          url: attachment.url,
          name: attachment.name,
          size: attachment.size || 0,
        }
      : undefined,
  });

  await post.populate('author', 'username profile.displayName profile.avatar profile.isVerified');
  return serializePost(post, authorId);
}

// El autor o un administrador pueden borrar. Se comprueba aquí y no solo en la
// interfaz: esconder el botón no impide una petición directa.
async function deletePost({ postId, actorId, actorRole }) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new HttpError(404, 'Publicación no encontrada');
  }
  const post = await Post.findById(postId);
  assertVisible(post);

  const isAuthor = String(post.author) === String(actorId);
  if (!isAuthor && actorRole !== 'admin') {
    throw new HttpError(403, 'No puedes eliminar esta publicación');
  }

  // Borrado lógico: se conserva el documento para que los avisos y los enlaces
  // que apuntaban a él no queden colgando, pero deja de servirse.
  await Post.updateOne({ _id: post._id }, { $set: { deletedAt: new Date() } });
  return { deleted: true };
}

// Me gusta idempotente sobre la publicación: el conjunto `likedBy` manda, así
// que tocar dos veces no infla el contador.
async function toggleLike({ postId, userId }) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new HttpError(404, 'Publicación no encontrada');
  }

  const liked = await Post.findOneAndUpdate(
    { _id: postId, likedBy: { $ne: userId }, deletedAt: null, hiddenAt: null },
    { $addToSet: { likedBy: userId }, $inc: { likes: 1 } },
    { new: true }
  );
  if (liked) {
    // Se avisa al autor salvo que se dé me gusta a uno mismo, cosa que el
    // propio servicio de avisos descarta.
    await notificationService.notify({
      recipientId: liked.author,
      actorId: userId,
      type: 'post_like',
      post: liked._id,
    });
    return { likes: liked.likes, liked: true };
  }

  const unliked = await Post.findOneAndUpdate(
    { _id: postId, likedBy: userId },
    { $pull: { likedBy: userId }, $inc: { likes: -1 } },
    { new: true }
  );
  if (!unliked) throw new HttpError(404, 'Publicación no encontrada');
  return { likes: unliked.likes, liked: false };
}

// Comentarios de una publicación, del más nuevo al más viejo.
async function listComments({ postId, limit = 20 }) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new HttpError(404, 'Publicación no encontrada');
  }
  const post = await Post.findById(postId).select('deletedAt hiddenAt');
  assertVisible(post);

  const comments = await PostComment.find({ post: postId, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('author', 'username profile.displayName profile.avatar profile.isVerified');

  return { comments: comments.map(publicComment) };
}

async function createComment({ postId, authorId, text }) {
  if (!mongoose.isValidObjectId(postId)) {
    throw new HttpError(404, 'Publicación no encontrada');
  }
  const post = await Post.findById(postId).select('author deletedAt hiddenAt');
  assertVisible(post);

  const clean = String(text || '').trim();
  if (!clean) throw new HttpError(400, 'El comentario no puede estar vacío');

  const comment = await PostComment.create({ post: postId, author: authorId, text: clean });
  await Post.updateOne({ _id: postId }, { $inc: { comments: 1 } });
  await comment.populate('author', 'username profile.displayName profile.avatar profile.isVerified');

  await notificationService.notify({
    recipientId: post.author,
    actorId: authorId,
    type: 'post_comment',
    post: postId,
    text: clean,
  });

  return publicComment(comment);
}

// El autor del comentario o un administrador pueden borrarlo.
async function deleteComment({ commentId, actorId, actorRole }) {
  if (!mongoose.isValidObjectId(commentId)) {
    throw new HttpError(404, 'Comentario no encontrado');
  }
  const comment = await PostComment.findById(commentId);
  if (!comment || comment.deletedAt) {
    throw new HttpError(404, 'Comentario no encontrado');
  }

  const isAuthor = String(comment.author) === String(actorId);
  if (!isAuthor && actorRole !== 'admin') {
    throw new HttpError(403, 'No puedes eliminar este comentario');
  }

  // Se vacía el texto por actualización y no con `save()`: `text` es `required`
  // y guardar el documento ya vaciado fallaría la validación. La validación
  // sigue protegiendo la creación, que es donde importa.
  await PostComment.updateOne(
    { _id: comment._id },
    { $set: { deletedAt: new Date(), deletedBy: actorId, text: '' } }
  );
  await Post.updateOne({ _id: comment.post }, { $inc: { comments: -1 } });
  return { deleted: true };
}

// Me gusta en un comentario del muro.
async function toggleCommentLike({ commentId, userId }) {
  if (!mongoose.isValidObjectId(commentId)) {
    throw new HttpError(404, 'Comentario no encontrado');
  }
  const liked = await PostComment.findOneAndUpdate(
    { _id: commentId, likedBy: { $ne: userId }, deletedAt: null },
    { $addToSet: { likedBy: userId }, $inc: { likes: 1 } },
    { new: true }
  );
  if (liked) return { likes: liked.likes, liked: true };

  const unliked = await PostComment.findOneAndUpdate(
    { _id: commentId, likedBy: userId },
    { $pull: { likedBy: userId }, $inc: { likes: -1 } },
    { new: true }
  );
  if (!unliked) throw new HttpError(404, 'Comentario no encontrado');
  return { likes: unliked.likes, liked: false };
}

// Forma pública de una publicación. `liked` se calcula contra el conjunto
// `likedBy` que ya viene cargado, sin consulta aparte.
function serializePost(post, viewerId) {
  const doc = post.toObject ? post.toObject() : post;
  const likedBy = (doc.likedBy || []).map(String);
  return {
    _id: doc._id,
    text: doc.text,
    attachment: doc.attachment || null,
    likes: doc.likes,
    comments: doc.comments,
    liked: viewerId ? likedBy.includes(String(viewerId)) : false,
    createdAt: doc.createdAt,
    author: publicAuthor(doc.author),
  };
}

module.exports = {
  PAGE_SIZE,
  listFeed,
  getPost,
  createPost,
  deletePost,
  toggleLike,
  listComments,
  createComment,
  deleteComment,
  toggleCommentLike,
};
