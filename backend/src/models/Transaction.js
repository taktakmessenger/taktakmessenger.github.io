const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    amount: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      // `gift` and `gift_bonus` are the two faces of a gift: the paid path
      // credits withdrawable Diamonds, the promotional path credits spend-only
      // coins. Keeping them apart is what makes the money trail auditable.
      enum: [
        'gift',
        'gift_bonus',
        'withdraw',
        'purchase',
        // Compra pagada con TakCoin (TKC): no es dinero real (los TKC se
        // regalan minando), así que acredita monedas de regalo. Se apunta aparte
        // de `purchase` para que "cuánto entró" nunca cuente TKC como ingreso.
        'purchase_bonus',
        // Ingreso bruto de una venta de monedas. Guarda lo que pagó el
        // comprador; el reparto 40/60 va en `details`. Es la cifra de la que
        // salen "cuánto entró" y "cuánto es de la plataforma".
        'sale_revenue',
        'convert',
        'platform',
        'platform_bonus',
        'bonus',
        // Comisión de la casa en POKERTAK. La parte pagada es ingreso real; la
        // de regalo se queda en el circuito de monedas promocionales.
        'poker_rake',
        'poker_rake_bonus',
        // Torneos: entrada cobrada, premio pagado, devolución al cancelar y la
        // tarifa que se queda la casa del bote entero.
        'poker_event_entry',
        'poker_event_prize',
        'poker_event_refund',
        'poker_event_rake',
        'poker_event_rake_bonus',
        // Premio del programa de referidos: un porcentaje de lo que compró el
        // invitado, abonado a quien lo trajo. Siempre en monedas de regalo, así
        // que no es ingreso canjeable y se apunta aparte de `bonus`.
        'referral_bonus',
      ],
      required: true,
    },
    ttcType: { type: String, enum: ['ttcC', 'ttcR'], default: 'ttcC' },

    // Only populated for gifts: how the amount was split.
    creatorAmount: Number,
    platformAmount: Number,
    giftName: { type: String, trim: true, maxlength: 40 },
    // Catalogue entry the gift came from. Present for gifts priced server-side.
    giftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gift' },

    // Only populated for purchases: what the buyer actually paid.
    amountPaid: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3 },
    packageId: String,
    // Idempotency key from the payment provider. A unique index on this makes
    // replaying the same webhook a no-op instead of a double credit.
    externalId: { type: String, index: { unique: true, sparse: true } },

    // Clave de idempotencia del cliente. La manda la app al pedir un retiro
    // (una por intento): si la petición se reintenta —red que falla, el usuario
    // toca dos veces, el navegador reenvía— el segundo intento devuelve la
    // solicitud ya creada en vez de descontar los Diamantes otra vez. `sparse`
    // porque la mayoría de transacciones (regalos, compras, premios) no la
    // llevan.
    idempotencyKey: { type: String, index: { unique: true, sparse: true } },

    // Context / payout metadata.
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    method: String,
    details: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'rejected'],
      default: 'completed',
    },

    // Solo para retiros: quién y cuándo resolvió la solicitud. Sin esto no hay
    // forma de saber qué administrador pagó (o rechazó) un retiro, que es justo
    // lo que hace falta para responder a una reclamación del usuario.
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    // Motivo del rechazo, visible para el usuario cuando se le devuelven los
    // Diamantes.
    reason: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true }
);

transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ from: 1, createdAt: -1 });
// La cola de retiros se lista por tipo y estado, del más antiguo al más nuevo:
// es la consulta que hace el panel de administración.
transactionSchema.index({ type: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
