// Preferencia de sonido del feed. Se guarda en el navegador para que la
// decisión de la persona sobreviva a la recarga: si activó el sonido, no debe
// tener que volver a activarlo en cada visita.

export const SOUND_KEY = 'taktak_sound';

// El navegador bloquea el autoplay con sonido hasta que hay una interacción.
// Por eso el valor por defecto es "silenciado": el vídeo se reproduce solo,
// y el sonido es un acto explícito de la persona (tocar el altavoz).
export function readSoundOn(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(SOUND_KEY);
    return raw === 'true';
  } catch {
    // Almacenamiento no disponible (modo privado, políticas del navegador).
    // Se asume silencio en vez de romper el feed.
    return false;
  }
}

export function writeSoundOn(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(SOUND_KEY, on ? 'true' : 'false');
  } catch {
    // Sin persistencia, la preferencia solo dura la sesión. No es motivo para
    // dejar de reproducir.
  }
}

// Regla única de silencio: una tarjeta suena solo si es la visible y la
// persona activó el sonido. Se aísla aquí para poder probarla sin DOM.
export function isMuted(active, soundOn) {
  return !active || !soundOn;
}

// ¿Debe callarse el feed? Se calla cuando ya no es la vista (Facetak) y cuando
// hay una llamada en curso. Durante una llamada el vídeo de fondo competiría con
// la voz y, en el móvil, los botones de volumen regularían el vídeo en vez de la
// llamada: por eso la llamada pausa el feed aunque se siga viendo. Se aísla
// igual que `isMuted` para poder probar la regla sin DOM.
export function shouldPauseFeed(showingPosts, callStatus, idleStatus = 'idle') {
  return Boolean(showingPosts) || callStatus !== idleStatus;
}

// Salidas de audio disponibles (altavoz del teléfono, auriculares, Bluetooth).
// `setSinkId` no existe en todos los navegadores: Firefox y buena parte de
// Safari lo ignoran, así que se degrada a una lista vacía y la app sigue
// usando la salida por defecto del sistema.
export async function listAudioOutputs(mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Salida de audio' }));
  } catch {
    return [];
  }
}

// Envía el audio de un elemento a una salida concreta. Devuelve si se pudo.
export async function applySink(element, deviceId) {
  if (!element || typeof element.setSinkId !== 'function') return false;
  try {
    await element.setSinkId(deviceId);
    return true;
  } catch {
    return false;
  }
}

// Volumen del audio de una llamada, acotado a [0, 1]. Un valor fuera de rango
// lo ignora el navegador y el control parecería muerto. Un valor ausente (null,
// undefined o cadena vacía) se resuelve al máximo: `Number(null)` es 0, y sin
// este caso un dato que falta silenciaría la llamada en vez de dejarla sonar.
export function clampVolume(value) {
  if (value === null || value === undefined || value === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

// Aplica el volumen a un elemento de audio o vídeo. Devuelve el valor aplicado.
export function applyVolume(element, value) {
  const volume = clampVolume(value);
  if (element) element.volume = volume;
  return volume;
}

// Declara ante el sistema que la página está en una llamada. Con el tipo
// `play-and-record` el móvil enruta el sonido por el flujo de comunicación, que
// es el que controlan los botones de volumen del teléfono; sin declararlo, bajar
// el volumen durante una llamada puede no tener efecto. La API todavía no existe
// en todos los navegadores (Safari sí, Chrome no): si falta, no se hace nada y
// la app sigue funcionando.
export function applyAudioSession(type, nav = globalThis.navigator) {
  const session = nav?.audioSession;
  if (!session || typeof session !== 'object') return false;
  try {
    session.type = type;
    return true;
  } catch {
    return false;
  }
}
