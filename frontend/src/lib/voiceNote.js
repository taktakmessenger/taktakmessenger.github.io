// Notas de voz: elegir formato de grabación y preparar el archivo para subirlo.
//
// Se reúne aquí, fuera del componente, para poder probar la elección de formato
// y la extensión sin un navegador de verdad: son las dos decisiones donde un
// error se paga caro y silenciosamente.

// Candidatos de formato, en orden de preferencia. El navegador elige el primero
// que soporta; no todos graban en el mismo. Chrome y Edge dan webm/opus,
// Firefox prefiere ogg/opus, y Safari (que no trae opus) solo graba mp4/aac.
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];

/**
 * Devuelve el primer formato que el navegador sabe grabar, o cadena vacía si no
 * hay ninguno. Una cadena vacía es válida: `MediaRecorder` sin `mimeType` usa el
 * suyo por defecto, que siempre existe si `MediaRecorder` está disponible.
 */
export function pickAudioMimeType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder?.isTypeSupported) return '';
  for (const type of CANDIDATES) {
    try {
      if (Recorder.isTypeSupported(type)) return type;
    } catch {
      // Un navegador que lanza al consultar no debe tumbar la grabación: se
      // prueba el siguiente candidato.
    }
  }
  return '';
}

/**
 * Extensión de archivo que corresponde a un MIME de audio.
 *
 * Importa porque el servidor clasifica el adjunto por la extensión, no por el
 * MIME que declara el cliente (que no es de fiar). Un webm de solo audio se
 * llama `.weba` a propósito: con `.webm` el servidor lo tomaría por un vídeo y
 * la nota de voz saldría con un reproductor de vídeo.
 */
export function extensionForMime(mime) {
  const type = String(mime || '').toLowerCase();
  if (type.includes('ogg')) return '.ogg';
  if (type.includes('mp4') || type.includes('aac')) return '.m4a';
  // webm y el caso "sin mimeType" (el navegador usa webm por defecto en Chrome).
  return '.weba';
}

// Nombre del archivo con el que se sube la nota. Lleva la extensión correcta
// para el tipo, que es lo único que el servidor mira.
export function voiceNoteFileName(mime, now = Date.now()) {
  return `nota-de-voz-${now}${extensionForMime(mime)}`;
}

/**
 * Duración en segundos a partir de milisegundos, redondeada. El mínimo es 1:
 * una nota de 0,4 s no es "0 s", es una nota corta, y un cero se leería como un
 * error de la app.
 */
export function secondsFromMs(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  return Math.max(1, seconds);
}

/**
 * Formatea una duración para la burbuja: "0:07", "1:23". Sin horas, porque una
 * nota de voz de más de una hora no es un caso real.
 */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ¿Se puede grabar en este navegador? Sin `MediaRecorder` o sin
// `getUserMedia` no hay nada que hacer, y conviene saberlo antes de pintar el
// botón que dibujar uno que siempre falla.
export function canRecordAudio(nav = globalThis.navigator, Recorder = globalThis.MediaRecorder) {
  return Boolean(Recorder && nav?.mediaDevices?.getUserMedia);
}
