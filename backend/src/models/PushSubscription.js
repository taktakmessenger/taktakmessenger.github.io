const mongoose = require('mongoose');

/**
 * Una suscripción push = un navegador/dispositivo concreto.
 *
 * Va en su propia colección y no como array dentro de `User` por dos razones:
 * una persona puede tener varios dispositivos, y el `endpoint` (que asigna el
 * servicio de push) es único en el mundo. Indexarlo permite que volver a
 * suscribirse *actualice* la fila en vez de duplicarla — los navegadores rotan
 * el endpoint con el tiempo y sin esto la misma persona acumularía basura.
 */
const pushSubscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // URL del servicio de push del navegador. Único: identifica el dispositivo.
  endpoint: { type: String, required: true, unique: true },
  keys: {
    // Clave pública del cliente para cifrar el payload (ECDH).
    p256dh: { type: String, required: true },
    // Secreto de autenticación del cliente.
    auth: { type: String, required: true },
  },
  // Para saber en qué dispositivo sonó y poder limpiar por tipo si hiciera
  // falta. No es fiable al 100 % (el user agent miente), así que solo informa.
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
  // Último envío correcto. Una suscripción que lleva meses sin usarse suele
  // estar muerta, pero no se borra por eso: se borra cuando el servicio de push
  // responde 410.
  lastUsedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
