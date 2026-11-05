// Contactos del teléfono para el marcador de WhaTaka.
//
// El navegador no expone la agenda de forma automática: `navigator.contacts`
// solo existe en algunos navegadores móviles y, además, exige un gesto del
// usuario para pedir permiso. Por eso la app no puede leerla "sola" nada más
// arrancar; lo que sí puede es recordar lo que ya se leyó, sincronizarlo cuando
// el permiso ya está concedido y no volver a preguntar cada vez.
//
// Aquí va solo la parte pura (normalizar, fusionar, decidir si toca
// sincronizar); la llamada real a `navigator.contacts.select` vive en el
// componente, porque es la que abre el diálogo del sistema.

const CONTACTS_KEY = 'taktak_contacts_cache';
const PERMISSION_KEY = 'taktak_contacts_granted';
// No se vuelve a pedir la agenda en cada apertura del marcador: como máximo una
// vez cada pocos minutos. Preguntar cada vez es invasivo y, en la mayoría de
// navegadores, la segunda vez ni siquiera aparece el diálogo.
export const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export function contactsApiAvailable(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return Boolean(nav?.contacts?.select);
}

export function hasPermissionBeenGranted(storage = safeStorage()) {
  try {
    return storage?.getItem(PERMISSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPermissionGranted(storage = safeStorage()) {
  try {
    storage?.setItem(PERMISSION_KEY, '1');
  } catch {
    // Sin almacenamiento, la app vuelve a preguntar en la próxima sesión: no es
    // motivo para romper la importación que el usuario acaba de autorizar.
  }
}

export function forgetPermission(storage = safeStorage()) {
  try {
    storage?.removeItem(PERMISSION_KEY);
  } catch {
    // idem
  }
}

// ¿Toca sincronizar sola? Solo si el navegador da la agenda, el permiso ya se
// concedió antes y ha pasado el intervalo desde la última lectura.
export function shouldAutoSync({
  available = contactsApiAvailable(),
  granted = hasPermissionBeenGranted(),
  lastSync = 0,
  now = Date.now(),
} = {}) {
  if (!available || !granted) return false;
  return now - Number(lastSync || 0) >= SYNC_INTERVAL_MS;
}

// Convierte lo que devuelve `navigator.contacts.select` en la lista plana que
// usa el marcador: una entrada por teléfono, con el nombre repetido si el
// contacto tiene varios. Antes se hacía dentro del componente y sin filtrar los
// teléfonos vacíos, así que un contacto sin número añadía una fila inservible.
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
// dos) y no se duplican los del dispositivo, para que sincronizar dos veces no
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
    if (!raw || !Array.isArray(raw.list)) return { list: [], lastSync: 0 };
    return { list: raw.list, lastSync: Number(raw.lastSync) || 0 };
  } catch {
    return { list: [], lastSync: 0 };
  }
}

export function saveCache(list, lastSync = Date.now(), storage = safeStorage()) {
  try {
    storage?.setItem(CONTACTS_KEY, JSON.stringify({ list, lastSync }));
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
