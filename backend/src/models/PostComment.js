const mongoose = require('mongoose');

// Comentario de una publicación del muro. Es su propio documento por el mismo
// motivo que los comentarios de vídeo: un array dentro de la publicación
// crecería sin límite y obligaría a leer el hilo entero para pintar la tarjeta.
const postCommentSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
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
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    likes: { type: Number, default: 0, min: 0 },
    // Borrado lógico: se conserva el hueco para que el hilo no se renumere y un
    // moderador pueda ver que algo se retiró.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// El hilo de una publicación, del más nuevo al más viejo.
postCommentSchema.index({ post: 1, createdAt: -1 });

postCommentSchema.methods.isDeleted = function isDeleted() {
  return Boolean(this.deletedAt);
};

module.exports = mongoose.model('PostComment', postCommentSchema);
