const mongoose = require('mongoose');

// Detalles de una llamada, incrustados en el propio mensaje. Se guarda como
// subdocumento sin `_id` porque no tiene vida propia: nace y muere con la
// entrada del hilo que lo muestra.
const callInfoSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['audio', 'video'], required: true },
    status: {
      type: String,
      enum: ['answered', 'missed', 'declined', 'cancelled', 'unreachable'],
      required: true,
    },
    // Solo tiene sentido si la llamada se contestó; 0 en cualquier otro caso.
    durationSeconds: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// Adjunto de un mensaje. Igual que `call`, vive dentro del mensaje: no tiene
// identidad propia ni se consulta por separado.
const attachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['image', 'video', 'audio', 'file'], required: true },
    // Ruta servible, relativa al dominio (por ejemplo `/uploads/chat/...`).
    url: { type: String, required: true },
    // Nombre original, ya limpio. Es el que se ve en el chat y el que se usa al
    // descargar.
    name: { type: String, required: true },
    size: { type: Number, default: 0, min: 0 },
    // Solo para audio y vídeo, cuando el cliente lo conoce.
    durationSeconds: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Una llamada vive en el mismo flujo que el texto, como en WhatsApp. Así el
    // hilo la ordena, el contador de no leídos la cuenta y la paginación la
    // pagina sin código adicional. `kind` decide cómo se pinta.
    kind: { type: String, enum: ['text', 'call', 'attachment'], default: 'text' },
    call: { type: callInfoSchema, default: undefined },
    attachment: { type: attachmentSchema, default: undefined },
    // Un mensaje puede llevar texto y adjunto a la vez (el pie de foto), por eso
    // no son excluyentes.
    text: {
      type: String,
      // Ni una llamada ni un adjunto exigen cuerpo: el texto es opcional en
      // ambos casos. La validación de que hay algo que enviar vive en el
      // servicio, que es quien conoce las dos partes.
      required: function requiredText() {
        return this.kind === 'text';
      },
      trim: true,
      maxlength: 2000,
    },
    // Soft delete: a message removed for everyone is blanked but the row stays,
    // so the other participant's history does not shift.
    deletedAt: { type: Date, default: null },

    // Recibos, al estilo WhatsApp. Se guardan como listas de ids de usuario (no
    // un booleano) porque el mismo documento se leerá en chats de grupo: con un
    // booleano no se puede saber quién leyó y quién no.
    //
    // `deliveredTo` se marca cuando el mensaje llega al dispositivo del
    // destinatario (un socket suyo lo recibe); `readTo` cuando abre el hilo.
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    readTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

// Reading a thread: newest messages of one conversation, paginated.
messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
