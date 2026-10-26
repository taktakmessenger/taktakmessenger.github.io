const mongoose = require('mongoose');

// Un reporte de contenido o de una persona. Es la pieza que faltaba para que la
// moderación no dependa de que un administrador se tope por casualidad con algo:
// hasta ahora un vídeo ofensivo, un acoso por chat o un perfil falso no tenían
// ningún camino para llegar a una persona que pudiera actuar.
//
// Se guarda quién lo reporta, qué se reporta (con su tipo) y por qué. No hay
// estado en el propio reporte más allá de si ya se atendió: el trabajo de
// moderación se hace sobre el objeto reportado, no sobre la fila del reporte.
const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Qué se está reportando. Se guarda el tipo aparte del id porque un id
    // suelto no dice a qué colección pertenece y el `ref` de Mongoose no
    // admite un valor dinámico.
    targetType: {
      type: String,
      enum: ['video', 'user', 'post', 'comment', 'post_comment', 'message'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Por qué. La lista es cerrada para que la cola de moderación se pueda
    // agrupar y priorizar; "otro" va acompañado de `details`.
    reason: {
      type: String,
      enum: [
        'spam',
        'harassment',
        'hate',
        'violence',
        'nudity',
        'misinformation',
        'impersonation',
        'self_harm',
        'other',
      ],
      required: true,
    },
    details: { type: String, trim: true, maxlength: 500, default: '' },

    status: {
      type: String,
      enum: ['open', 'reviewing', 'actioned', 'dismissed'],
      default: 'open',
      index: true,
    },
    // Nota del moderador: por qué se actuó o por qué no.
    resolutionNote: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// La cola se lee por estado y fecha: lo abierto primero, lo más reciente antes.
reportSchema.index({ status: 1, createdAt: -1 });
// Un reporte por persona y objeto: reportar diez veces lo mismo no es diez
// veces más urgente, y sin este índice un usuario enfadado podría inflar la
// cola él solo.
reportSchema.index({ reporter: 1, targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);
