const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const { HttpError } = require('../utils/http');

const PAGE_SIZE = 20;
const MAX_PHOTOS = 8;

// Forma pública del vendedor, aplanada igual que la del autor de una
// publicación: la pantalla no debe navegar el documento de Mongoose, y un `_id`
// suelto rompería el render de la tarjeta.
function publicSeller(seller) {
  if (!seller || typeof seller !== 'object' || !seller.username) return seller;
  return {
    _id: seller._id,
    username: seller.username,
    displayName: seller.profile?.displayName || null,
    avatar: seller.profile?.avatar || null,
    isVerified: Boolean(seller.profile?.isVerified),
  };
}

// Un anuncio no visible (borrado o retirado) no existe para quien no lo
// administra. Se responde el mismo 404 que si nunca hubiera estado.
function assertVisible(listing) {
  if (!listing || !listing.isVisible()) {
    throw new HttpError(404, 'Anuncio no encontrado');
  }
}

// Normaliza las fotos que llegan del cliente. Se exige que sean de nuestra
// propia subida: si no, Marketak sería un escaparate de URLs externas.
function cleanPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  if (photos.length > MAX_PHOTOS) {
    throw new HttpError(400, `Máximo ${MAX_PHOTOS} fotos por anuncio`);
  }
  return photos.map((photo) => {
    const url = String(photo?.url || '');
    if (!url.startsWith('/uploads/market/')) {
      throw new HttpError(400, 'Foto inválida');
    }
    return {
      url,
      name: String(photo.name || 'foto').slice(0, 120),
      size: Number(photo.size) || 0,
    };
  });
}

// Marketak general: los anuncios visibles, del más nuevo al más viejo, con
// filtro opcional por categoría y por texto. Paginado por `createdAt` (keyset).
async function listListings({ cursor, limit = PAGE_SIZE, category, q, sellerId } = {}) {
  const filter = { deletedAt: null, hiddenAt: null };
  if (category) filter.category = category;
  if (sellerId) {
    if (!mongoose.isValidObjectId(sellerId)) throw new HttpError(400, 'Vendedor inválido');
    filter.seller = sellerId;
  }
  if (cursor) filter.createdAt = { $lt: new Date(cursor) };

  // La búsqueda por texto se hace con una expresión regular escapada y no con
  // `$text`: `$text` exige un índice de texto y no busca por subcadenas, que es
  // lo que espera quien escribe "bici" y quiere ver "bicicleta".
  if (q) {
    const safe = String(q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (safe) {
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ title: rx }, { description: rx }];
    }
  }

  const listings = await Listing.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('seller', 'username profile.displayName profile.avatar profile.isVerified');

  const nextCursor = listings.length === limit ? listings[listings.length - 1].createdAt : null;

  return {
    listings: listings.map(serializeListing),
    nextCursor,
  };
}

async function getListing({ listingId }) {
  if (!mongoose.isValidObjectId(listingId)) {
    throw new HttpError(404, 'Anuncio no encontrado');
  }
  const listing = await Listing.findById(listingId).populate(
    'seller',
    'username profile.displayName profile.avatar profile.isVerified'
  );
  assertVisible(listing);

  // El contador de visitas se incrementa al abrir el detalle, no en el listado:
  // contar cada aparición en la cuadrícula inflaría el número sin que nadie
  // haya mirado el anuncio.
  await Listing.updateOne({ _id: listing._id }, { $inc: { views: 1 } });
  const serialized = serializeListing(listing);
  serialized.views += 1;
  return serialized;
}

async function createListing({ sellerId, title, description, price, category, condition, location, photos }) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new HttpError(400, 'El anuncio necesita un título');

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    throw new HttpError(400, 'Precio inválido');
  }

  // La categoría se valida aquí además de en el `enum` del modelo para
  // responder un 400 claro en vez de un error de validación de Mongoose.
  if (category && !Listing.CATEGORIES.includes(category)) {
    throw new HttpError(400, 'Categoría inválida');
  }
  if (condition && !['nuevo', 'como_nuevo', 'usado'].includes(condition)) {
    throw new HttpError(400, 'Estado del artículo inválido');
  }

  const listing = await Listing.create({
    seller: sellerId,
    title: cleanTitle,
    description: String(description || '').trim(),
    price: Math.round(numericPrice),
    category: category || 'otros',
    condition: condition || 'usado',
    location: String(location || '').trim(),
    photos: cleanPhotos(photos),
  });

  await listing.populate('seller', 'username profile.displayName profile.avatar profile.isVerified');
  return serializeListing(listing);
}

// El vendedor o un administrador pueden borrar. Se comprueba aquí y no solo en
// la interfaz: esconder el botón no impide una petición directa.
async function deleteListing({ listingId, actorId, actorRole }) {
  if (!mongoose.isValidObjectId(listingId)) {
    throw new HttpError(404, 'Anuncio no encontrado');
  }
  const listing = await Listing.findById(listingId);
  assertVisible(listing);

  const isSeller = String(listing.seller) === String(actorId);
  if (!isSeller && actorRole !== 'admin') {
    throw new HttpError(403, 'No puedes eliminar este anuncio');
  }

  await Listing.updateOne({ _id: listing._id }, { $set: { deletedAt: new Date() } });
  return { deleted: true };
}

// Marcar como vendido (o volver a ponerlo a la venta). Solo el vendedor.
async function setStatus({ listingId, actorId, actorRole, status }) {
  if (!mongoose.isValidObjectId(listingId)) {
    throw new HttpError(404, 'Anuncio no encontrado');
  }
  const listing = await Listing.findById(listingId);
  assertVisible(listing);

  const isSeller = String(listing.seller) === String(actorId);
  if (!isSeller && actorRole !== 'admin') {
    throw new HttpError(403, 'No puedes modificar este anuncio');
  }

  const next = status === 'sold' ? 'sold' : 'active';
  await Listing.updateOne({ _id: listing._id }, { $set: { status: next } });
  return { status: next };
}

// Forma pública de un anuncio. Se aplana el vendedor para que la tarjeta no
// tenga que navegar el documento.
function serializeListing(listing) {
  const doc = listing.toObject ? listing.toObject() : listing;
  return {
    _id: doc._id,
    title: doc.title,
    description: doc.description,
    price: doc.price,
    category: doc.category,
    condition: doc.condition,
    location: doc.location,
    photos: doc.photos || [],
    status: doc.status,
    views: doc.views,
    createdAt: doc.createdAt,
    seller: publicSeller(doc.seller),
  };
}

module.exports = {
  PAGE_SIZE,
  MAX_PHOTOS,
  listListings,
  getListing,
  createListing,
  deleteListing,
  setStatus,
  serializeListing,
};
