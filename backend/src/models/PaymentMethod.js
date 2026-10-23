const mongoose = require('mongoose');

// Métodos de pago guardados por el usuario.
//
// Regla que no se negocia: aquí NUNCA se guarda el número de tarjeta ni el
// CVV. Guardarlos convertiría a TAK TAK en depositario de datos de tarjeta y
// arrastraría todo el peso de PCI-DSS, además de que un vuelco de la base
// entregaría tarjetas usables. La tarjeta la guarda Stripe; nosotros guardamos
// solo la referencia (`providerRef`) y lo que hace falta para pintarla en la
// lista: marca, últimos cuatro dígitos y caducidad.
//
// `providerRef` es lo único con lo que se puede cobrar. Por eso no se expone
// nunca al cliente tal cual en las respuestas públicas: se devuelve el `_id`
// de Mongo y el cliente pide el cobro por ese id, que además está atado al
// usuario dueño.
const paymentMethodSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    provider: {
      type: String,
      enum: ['stripe', 'paypal'],
      required: true,
    },

    // `card` para tarjeta, `paypal` para la cuenta de PayPal. Se guarda aparte
    // de `provider` porque un mismo proveedor podría añadir otros medios más
    // adelante (SEPA, por ejemplo) sin migrar los datos.
    kind: {
      type: String,
      enum: ['card', 'paypal'],
      required: true,
    },

    // Referencia del proveedor con la que se cobra: `pm_...` en Stripe, el
    // `vault_id` en PayPal. Nunca sale del servidor.
    providerRef: { type: String, required: true },

    // --- Presentación de la tarjeta (nunca el PAN) ---
    brand: { type: String, trim: true, maxlength: 20 },
    last4: { type: String, trim: true, maxlength: 4 },
    expMonth: { type: Number, min: 1, max: 12 },
    expYear: { type: Number },

    // --- Presentación de PayPal ---
    // Correo de la cuenta de PayPal. No es un secreto, pero se expone solo al
    // dueño.
    email: { type: String, trim: true, lowercase: true },

    // Nombre que le pone el usuario ("mi tarjeta del trabajo"). Si no hay, la
    // UI compone uno a partir de la marca y los últimos dígitos.
    label: { type: String, trim: true, maxlength: 40 },

    isDefault: { type: Boolean, default: false },

    // Marca de baja lógica. Cuando el usuario borra un método se intenta
    // desvincular del proveedor; si esa llamada falla (red, proveedor caído),
    // el método se marca `revoked` igualmente para que no se pueda volver a
    // cobrar, y la limpieza se puede reintentar luego.
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Un mismo método del proveedor no puede guardarse dos veces para el mismo
// usuario. Evita duplicados cuando el webhook y la vuelta del navegador
// procesan el mismo alta a la vez.
paymentMethodSchema.index({ user: 1, providerRef: 1 }, { unique: true });

// La lista se pinta por usuario, con el predeterminado primero.
paymentMethodSchema.index({ user: 1, revoked: 1, isDefault: -1, createdAt: -1 });

// Un solo predeterminado por usuario. No se puede expresar como índice único
// parcial sencillo sobre todos los proveedores, así que la regla vive en el
// servicio, que lo cambia en una sola operación atómica.
paymentMethodSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    provider: this.provider,
    kind: this.kind,
    brand: this.brand || null,
    last4: this.last4 || null,
    expMonth: this.expMonth ?? null,
    expYear: this.expYear ?? null,
    email: this.email || null,
    label: this.label || null,
    isDefault: this.isDefault,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
