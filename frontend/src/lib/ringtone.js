// Tono de llamada y vibración.
//
// Con la app abierta, hasta ahora una llamada entrante solo pintaba la pantalla:
// si el teléfono estaba en el bolsillo o mirando otro sitio, nadie se enteraba.
// Esto le pone sonido y vibración, como WhatsApp.
//
// El tono se genera con la Web Audio API en vez de usar un fichero de audio: así
// no hay que descargar nada, suena al instante y no depende de que un `.mp3`
// esté en el sitio correcto. La vibración usa la Vibration API (Android; en iOS
// y escritorio se ignora sin más).

import { findRingtone, DEFAULT_RINGTONE_ID } from './ringtones.js';

let ctx = null;
let stopCurrent = null;
let ringingMode = null;

// Se emite un evento al arrancar y al parar el tono. El estado interno no basta
// para observarlo desde fuera (con el recambio de módulos de Vite puede haber
// más de una copia del módulo), así que el evento es la señal fiable de que el
// timbre suena. Lo consume la comprobación automática de llamadas.
function announce(mode) {
  try {
    globalThis.dispatchEvent?.(
      new CustomEvent('taktak:ringtone', { detail: { ringing: mode } })
    );
  } catch {
    // Un entorno sin CustomEvent (por ejemplo, una prueba en Node) no necesita
    // el evento; el estado interno sigue siendo correcto.
  }
}

function getContext() {
  if (ctx) return ctx;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  ctx = new AudioContextClass();
  return ctx;
}

/**
 * Prepara el audio a partir de un gesto del usuario.
 *
 * Los navegadores no dejan sonar nada hasta que la persona ha interactuado con
 * la página: un tono generado en un evento del servidor suena mudo si nunca
 * hubo un toque. Se llama en el primer toque para dejar el audio listo.
 */
export function unlockAudio() {
  const context = getContext();
  if (!context) return;
  if (context.state === 'suspended') context.resume().catch(() => {});
}

// Un pitido corto: la unidad básica con la que se arma el patrón de timbre.
function beep(context, { startAt, frequency, duration, gain = 0.08 }) {
  const osc = context.createOscillator();
  const volume = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  // Envolvente de subida y bajada: un tono con corte en seco hace "clic".
  const attack = 0.02;
  volume.gain.setValueAtTime(0, startAt);
  volume.gain.linearRampToValueAtTime(gain, startAt + attack);
  volume.gain.setValueAtTime(gain, startAt + duration - attack);
  volume.gain.linearRampToValueAtTime(0, startAt + duration);

  osc.connect(volume);
  volume.connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

// Patrones en segundos. El saliente (se está llamando) es un tono más grave y
// espaciado, para saber que suena sin molestar; el entrante sale del catálogo
// de repiques elegido por la persona.
const OUTGOING = {
  pattern: [{ offset: 0, frequency: 440, duration: 0.5 }],
  periodMs: 3000,
  vibration: [200],
};

/**
 * Empieza a sonar y vibrar. `mode` es 'incoming' (alguien llama) o 'outgoing'
 * (se está llamando a alguien).
 *
 * `ringtoneId` elige el repique del catálogo; solo aplica al modo entrante, que
 * es el que la persona configura. Es idempotente para la misma combinación:
 * llamarlo dos veces no apila dos tonos.
 */
export function startRingtone(mode = 'incoming', ringtoneId = DEFAULT_RINGTONE_ID) {
  stopRingtone();

  const preset = mode === 'outgoing' ? OUTGOING : findRingtone(ringtoneId);
  const pattern = preset.pattern;
  const periodMs = preset.periodMs;
  const vibratePattern = preset.vibration;
  ringingMode = mode;
  announce(mode);

  const context = getContext();
  let timer = null;

  if (context) {
    if (context.state === 'suspended') context.resume().catch(() => {});
    const playPattern = () => {
      const now = context.currentTime;
      for (const tone of pattern) beep(context, { ...tone, startAt: now + tone.offset });
    };
    playPattern();
    timer = setInterval(playPattern, periodMs);
  }

  // La vibración va por su cuenta: aunque el navegador tenga el audio bloqueado
  // (nunca hubo un toque), el teléfono debe notarse.
  let vibrateTimer = null;
  const vibrate = () => {
    globalThis.navigator?.vibrate?.(vibratePattern);
  };
  vibrate();
  vibrateTimer = setInterval(vibrate, periodMs);

  stopCurrent = () => {
    if (timer) clearInterval(timer);
    if (vibrateTimer) clearInterval(vibrateTimer);
    globalThis.navigator?.vibrate?.(0);
  };
}

export function stopRingtone() {
  const wasRinging = ringingMode;
  ringingMode = null;
  if (stopCurrent) {
    stopCurrent();
    stopCurrent = null;
  }
  if (wasRinging) announce(null);
}

// Indica si hay un tono sonando y de qué tipo ('incoming' | 'outgoing'). Se usa
// para comprobar en las pruebas que el timbre arranca y para de verdad.
export function isRinging() {
  return ringingMode;
}
