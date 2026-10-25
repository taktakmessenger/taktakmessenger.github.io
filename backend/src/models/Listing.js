const mongoose = require('mongoose');

// Una foto del anuncio. Igual que los adjuntos de Facetak, vive dentro del
// documento: nace y muere con el anuncio y nunca se consulta por separado.
const photoSchema = new mongoose.Schema(
  {
    // Ruta servible y propia (`/uploads/market/...`). Se exige que sea de
    // nuestra subida para que Marketak no sea un escaparate de URLs ajenas.
    url: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// Categorías de Marketak. Son un `enum` y no texto libre a propósito: con texto
// libre, "Celulares", "celulares" y "celu" acaban siendo tres categorías y el
// filtro deja de servir. Las etiquetas en español las pone la interfaz.
const CATEGORIES = [
  'electronica',
  'ropa',
  'hogar',
  'vehiculos',
  'servicios',
  'mascotas',
  'otros',
];

// Un anuncio de Marketak: el mercado de segunda mano dentro de Facetak.
//
// El precio va en TTC (monedas de la app), que es la unidad que ya existe en
// toda la aplicación. El pago no se cierra dentro de Marketak: el comprador
// contacta por WhaTaka y acuerdan la entrega, como en un tablón de anuncios.
// Guardar el dinero en depósito exigiría un arbitraje de disputas que este
// producto todavía no tiene.
const listingSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    price: { type: Number, required: true, min: 0, max: 100000000 },
    category: { type: String, enum: CATEGORIES, default: 'otros', index: true },
    condition: {
      type: String,
      enum: ['nuevo', 'como_nuevo', 'usado'],
      default: 'usado',
    },
    // Zona aproximada ("Centro", "Chapinero"). Texto corto y opcional: la
    // ubicación exacta no debe publicarse, se acuerda en el chat.
    location: { type: String, trim: true, maxlength: 80, default: '' },
    photos: { type: [photoSchema], default: [] },

    // `sold` no borra el anuncio: queda visible como vendido para que el
    // vendedor no tenga que republicarlo y quien lo buscaba sepa que se cerró.
    status: { type: String, enum: ['active', 'sold'], default: 'active', index: true },

    views: { type: Number, default: 0, min: 0 },

    // Retirado por moderación: deja de servirse sin borrarse, para conservar el
    // rastro. Mismo criterio que en las publicaciones de Facetak.
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Borrado lógico: se conserva el documento para no dejar enlaces colgando.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// El listado general: los anuncios visibles, del más nuevo al más viejo.
listingSchema.index({ createdAt: -1 });
// El filtro por categoría, que es el que más se usa para navegar.
listingSchema.index({ category: 1, createdAt: -1 });
// El Marketak de un vendedor concreto.
listingSchema.index({ seller: 1, createdAt: -1 });

listingSchema.methods.isVisible = function isVisible() {
  return !this.deletedAt && !this.hiddenAt;
};

const Listing = mongoose.model('Listing', listingSchema);
Listing.CATEGORIES = CATEGORIES;
module.exports = Listing;
