const mongoose = require('mongoose');

// Conversación del asistente del administrador.
//
// Existe porque el historial vivía solo en el navegador: al recargar la página
// o entrar desde otro dispositivo el asistente empezaba de cero y respondía que
// no tenía conversación previa. Con el hilo guardado en la base, la memoria es
// del administrador y no de una pestaña.
//
// Solo se guardan los turnos de texto (usuario y asistente). Las llamadas a
// herramientas y sus resultados se reconstruyen en cada petición y no aportan
// nada al hilo: guardarlos llenaría la conversación de JSON interno.
const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 4000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const assistantThreadSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AssistantThread', assistantThreadSchema);
