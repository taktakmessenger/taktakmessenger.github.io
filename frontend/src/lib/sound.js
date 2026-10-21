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
