const mongoose = require('mongoose');

// Un aviso de actividad para el usuario: quién le regaló, quién le empezó a
// seguir, quién le dio me gusta o le comentó.
//
// Existe porque hasta ahora el regalo era mudo: el dinero se movía, el saldo
// subía y el creador no sabía quién ni por qué. Sin un registro, tampoco podía
// reconstruirlo después, porque el historial de regalos recibidos no se guarda
// en ninguna otra parte. Este documento es esa memoria.
const notificationSchema = new mongoose.Schema(
  {
    // Quien recibe el aviso. Nunca es el mismo que `actor`: una acción propia
    // no se notifica a uno mismo.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Quien hizo la acción. Se guarda el id, no el nombre, para que un cambio
    // de nombre de usuario no deje avisos viejos mintiendo.
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      // Los avisos de Facetak son tipos aparte de los del vídeo: reusar `like`
      // diría "le gustó tu vídeo" cuando fue una publicación de Facetak, que es
      // falso. El texto de cada aviso se elige por el tipo, así que cada origen
      // necesita el suyo.
      enum: ['gift', 'follow', 'like', 'comment', 'reply', 'post_like', 'post_comment'],
      required: true,
    },
    // Contexto de la acción. Opcionales porque no todos los tipos los tienen:
    // un seguidor nuevo no apunta a ningún vídeo.
    video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', default: null },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    // Publicación de Facetak a la que apunta un aviso de `post_like` o
    // `post_comment`, para poder abrirla desde la lista de actividad.
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    // Cuánto valía el regalo, en TTC-C. Se guarda el importe y no una
    // referencia a la transacción para que el aviso se pueda pintar solo, sin
    // un `populate` extra por cada elemento de la lista.
    amount: { type: Number, default: null },
    giftName: { type: String, default: null, maxlength: 40 },
    // Recorte del comentario, para que la lista muestre de qué se habla sin
    // abrir el hilo.
    preview: { type: String, default: null, maxlength: 120 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// La consulta de la pantalla: los avisos de un usuario, del más nuevo al más
// viejo. Es el mismo orden en que se paginan, así que el índice sirve para
// ambas cosas.
notificationSchema.index({ recipient: 1, createdAt: -1 });

// El contador de la campana. Índice aparte porque `read` no forma parte del
// orden de la lista: sin él, contar los no leídos recorrería todos los avisos
// de la cuenta, que con el tiempo son muchos.
notificationSchema.index({ recipient: 1, read: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
