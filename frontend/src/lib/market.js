// Datos de presentación de Marketak. Viven fuera del componente para poder
// probarse sin DOM, igual que el resto de reglas de la interfaz.
//
// Las claves coinciden con el `enum` del modelo del backend; aquí solo se
// traducen a etiquetas. El orden es el que se muestra en el filtro.
export const CATEGORY_LABELS = {
  electronica: '📱 Electrónica',
  ropa: '👕 Ropa',
  hogar: '🏠 Hogar',
  vehiculos: '🚗 Vehículos',
  servicios: '🛠️ Servicios',
  mascotas: '🐾 Mascotas',
  otros: '📦 Otros',
};

export const CONDITION_LABELS = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  usado: 'Usado',
};

export const MAX_PHOTOS = 8;

export function categoryLabel(value) {
  return CATEGORY_LABELS[value] || CATEGORY_LABELS.otros;
}

export function conditionLabel(value) {
  return CONDITION_LABELS[value] || value;
}

// El precio se muestra siempre en TTC, la moneda de la app. Se redondea a entero
// porque Marketak no maneja fracciones de moneda.
export function formatPrice(value) {
  return `${Number(value || 0).toLocaleString('es')} TTC`;
}

export function relativeTime(value, now = Date.now()) {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(value).toLocaleDateString();
}

// ¿Puede esta persona gestionar (marcar vendido / borrar) el anuncio? El
// vendedor sí, y un administrador también. Es la misma regla que aplica el
// servidor; aquí solo decide qué botones se ven.
export function canManageListing(user, listing) {
  if (!user || !listing?.seller) return false;
  const userId = user.id || user._id;
  return listing.seller._id === userId || user.role === 'admin';
}
