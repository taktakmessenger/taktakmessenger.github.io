// Contactos del teléfono para el marcador de WhaTaka.
//
// Aviso importante, porque condiciona todo el diseño: la Contact Picker API del
// navegador (`navigator.contacts.select`) **no tiene permiso permanente**. Cada
// llamada abre el selector del sistema, exige un gesto del usuario y este elige
// otra vez qué contactos comparte (Chrome y MDN lo dicen explícitamente: el
// acceso es por uso, no persistente). No existe forma de leer la agenda "sola"
// desde una web.
//
// Lo que sí se puede, y es lo que hace la app: recordar los contactos que el
// usuario ya compartió, para que **aparezcan solos** la próxima vez que abra el
// marcador sin tener que volver a elegirlos. Para traer cambios recientes hace
// falta un toque («Actualizar»), porque ahí el navegador vuelve a pedir el gesto.
//
// Aquí va solo la parte pura (normalizar, fusionar, guardar la caché); la
// llamada real a `navigator.contacts.select` vive en el componente, porque es
// la que abre el diálogo del sistema.

const CONTACTS_KEY = 'taktak_contacts_cache';

export function contactsApiAvailable(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return Boolean(nav?.contacts?.select);
}

// Convierte lo que devuelve `navigator.contacts.select` en la lista plana que
// usa el marcador: una entrada por teléfono, con el nombre repetido si el
// contacto tiene varios. Se filtran los teléfonos vacíos, que si no añadían una
// fila inservible.
export function flattenContacts(picked) {
  const list = [];
  for (const entry of picked || []) {
    const name = firstNonEmpty(entry?.name) || 'Sin nombre';
    const phones = (entry?.tel || []).map((t) => String(t).trim()).filter(Boolean);
    for (const phone of phones) {
      list.push({ name, phone, source: 'device' });
    }
  }
  return list;
}

// `name` puede llegar como array (lo normal en la Contact Picker API) o como
// cadena en implementaciones más laxas. Se acepta lo primero no vacío.
function firstNonEmpty(value) {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return '';
}

// Fusiona la agenda del teléfono con los contactos guardados a mano. Se
// conservan los manuales (tienen prioridad si el mismo número aparece en los
// dos) y no se duplican los del dispositivo, para que refrescar dos veces no
// llene la lista de repetidos.
export function mergeContacts(device, manual) {
  const seen = new Set();
  const out = [];
  for (const c of manual || []) {
    const key = `${c.name}\u0000${c.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, manual: true, source: c.source || 'manual' });
  }
  for (const c of device || []) {
    const key = `${c.name}\u0000${c.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function loadCache(storage = safeStorage()) {
  try {
    const raw = JSON.parse(storage?.getItem(CONTACTS_KEY) || 'null');
    if (!raw || !Array.isArray(raw.list)) return { list: [], savedAt: 0 };
    return { list: raw.list, savedAt: Number(raw.savedAt) || 0 };
  } catch {
    return { list: [], savedAt: 0 };
  }
}

export function saveCache(list, savedAt = Date.now(), storage = safeStorage()) {
  try {
    storage?.setItem(CONTACTS_KEY, JSON.stringify({ list, savedAt }));
  } catch {
    // Sin almacenamiento los contactos siguen usables en esta sesión.
  }
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
