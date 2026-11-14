const mongoose = require('mongoose');

// Una orden de cobro manual: el usuario paga por fuera de la app (billetera
// cripto, transferencia…) y envía la referencia; un administrador la aprueba.
//
// Es el único camino de cobro que no depende de ninguna pasarela, así que
// funciona sin cuenta de empresa y sin webhooks: nada que mantener encendido ni
// que consuma horas de instancia. A cambio, el abono no es automático: lo
// dispara una persona cuando comprueba el ingreso.
const manualOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    packageId: { type: String, required: true },
    // Copia del catálogo en el momento de crear la orden. El precio y las
    // monedas quedan congelados aquí: si el catálogo cambia después, una orden
    // ya enviada no se revaloriza ni se abarata sola.
    coins: { type: Number, required: true, min: 0 },
    priceUsd: { type: Number, required: true, min: 0 },
    method: { type: String, required: true, trim: true },
    // Si el método es TakCoin (TKC): la compra NO se pagó con dinero real, así
    // que al aprobarla se acreditan monedas de regalo (no retirables) en vez de
    // monedas pagadas. Se guarda en la orden para que el abono lo respete.
    takcoin: { type: Boolean, default: false },
    reference: { type: String, required: true, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    // Cómo se resolvió: lo pone la persona que revisa, o el asistente cuando
    // aprueba solo. Deja rastro de por qué se acreditó cada orden.
    reviewNote: { type: String, trim: true, maxlength: 300 },
    rejectionReason: { type: String, trim: true, maxlength: 300 },
    // Asiento contable que respalda el abono, para poder auditar cada orden.
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  },
  { timestamps: true }
);

// La cola que abre el administrador: pendientes, la más reciente arriba.
manualOrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ManualOrder', manualOrderSchema);
