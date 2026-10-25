const mongoose = require('mongoose');

// Adjunto de una publicación. Igual que en el chat, vive dentro del documento:
// no tiene identidad propia ni se consulta por separado. Se guarda como
// subdocumento sin `_id` porque nace y muere con la publicación que lo muestra.
const attachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['image', 'video'], required: true },
    // Ruta servible, relativa al dominio (por ejemplo `/uploads/wall/...`).
    url: { type: String, required: true },
    // Nombre original, ya limpio.
    name: { type: String, required: true },
    size: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// Una publicación de Facetak: el equivalente a una entrada de Facebook. Puede ser
// solo texto, solo foto/vídeo, o las dos cosas (el pie de foto).
//
// Es un documento propio y no un campo del usuario por el mismo motivo que los
// comentarios: un Facetak con muchas entradas no debe obligar a leer la cuenta
// entera para pintar la primera página.
const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Una publicación puede ser solo texto, solo adjunto o las dos cosas. El
    // servicio exige que al menos una venga informada.
    text: { type: String, trim: true, maxlength: 2000, default: '' },
    attachment: { type: attachmentSchema, default: undefined },

    // El conjunto `likedBy` es la fuente de verdad del contador, igual que en
    // vídeos y comentarios: así un doble toque no infla el número.
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    likes: { type: Number, default: 0, min: 0 },
    // Denormalizado para poder pintar la tarjeta sin contar los comentarios.
    comments: { type: Number, default: 0, min: 0 },

    // Visibilidad. `public` sale en Facetak general; `friends` se guarda para
    // cuando existan las listas de amistad, y hoy se comporta como pública.
    visibility: {
      type: String,
      enum: ['public', 'friends'],
      default: 'public',
    },

    // Moderación: un administrador puede retirar una entrada sin borrarla, para
    // que quede el rastro. Retirada, no se sirve a nadie salvo al panel.
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Borrado lógico, como en los comentarios: se conserva el hueco para no
    // renumerar la lista, pero el contenido deja de servirse.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// La consulta de Facetak: las publicaciones visibles, de la más nueva a la más
// vieja. El mismo índice sirve para paginar por `createdAt`.
postSchema.index({ createdAt: -1 });
// Facetak de un perfil concreto.
postSchema.index({ author: 1, createdAt: -1 });

postSchema.methods.isVisible = function isVisible() {
  return !this.deletedAt && !this.hiddenAt;
};

module.exports = mongoose.model('Post', postSchema);
