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
    kind: { type: String, enum: ['text', 'call'], default: 'text' },
    call: { type: callInfoSchema, default: undefined },
    // Plain text only for now. Keeping the body as a string (rather than a
    // typed union) is deliberate: attachments and voice notes can be added as
    // optional fields without invalidating existing documents.
    text: {
      type: String,
      // Una entrada de llamada no lleva cuerpo; exigir texto obligaría a meter
      // una cadena de relleno en el historial.
      required: function requiredText() {
        return this.kind !== 'call';
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
