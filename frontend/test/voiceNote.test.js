import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickAudioMimeType,
  extensionForMime,
  voiceNoteFileName,
  secondsFromMs,
  formatDuration,
  canRecordAudio,
} from '../src/lib/voiceNote.js';

// La elección de formato y la extensión son las dos decisiones donde un error
// se paga callado: el servidor clasifica el adjunto por la extensión, así que
// un `.webm` donde debía ir un `.weba` convierte la nota de voz en un vídeo.

// --- Elección de formato ----------------------------------------------------

test('elige el primer formato que el navegador soporta', () => {
  const Recorder = {
    isTypeSupported: (type) => type === 'audio/ogg;codecs=opus',
  };
  assert.equal(pickAudioMimeType(Recorder), 'audio/ogg;codecs=opus');
});

test('prefiere webm/opus cuando está disponible', () => {
  const Recorder = { isTypeSupported: () => true };
  assert.equal(pickAudioMimeType(Recorder), 'audio/webm;codecs=opus');
});

test('sin ningún formato soportado devuelve vacío, no falla', () => {
  const Recorder = { isTypeSupported: () => false };
  // Cadena vacía es un valor válido: MediaRecorder sin mimeType usa el suyo.
  assert.equal(pickAudioMimeType(Recorder), '');
});

test('un navegador que lanza al consultar no tumba la grabación', () => {
  const Recorder = {
    isTypeSupported: (type) => {
      if (type.includes('webm')) throw new Error('boom');
      return type === 'audio/ogg';
    },
  };
  assert.equal(pickAudioMimeType(Recorder), 'audio/ogg');
});

test('sin MediaRecorder no se elige formato', () => {
  assert.equal(pickAudioMimeType(undefined), '');
  assert.equal(pickAudioMimeType({}), '');
});

// --- Extensión --------------------------------------------------------------

test('webm de solo audio se llama .weba, no .webm', () => {
  // Con .webm el servidor lo tomaría por un vídeo y la nota saldría con un
  // reproductor de vídeo.
  assert.equal(extensionForMime('audio/webm;codecs=opus'), '.weba');
  assert.equal(extensionForMime('audio/webm'), '.weba');
});

test('ogg va a .ogg y mp4/aac a .m4a', () => {
  assert.equal(extensionForMime('audio/ogg;codecs=opus'), '.ogg');
  assert.equal(extensionForMime('audio/ogg'), '.ogg');
  assert.equal(extensionForMime('audio/mp4'), '.m4a');
  assert.equal(extensionForMime('audio/aac'), '.m4a');
});

test('sin mimeType se asume webm, que es el defecto de Chrome', () => {
  assert.equal(extensionForMime(''), '.weba');
  assert.equal(extensionForMime(null), '.weba');
});

test('el nombre del archivo lleva la extensión correcta', () => {
  assert.equal(voiceNoteFileName('audio/ogg', 1700000000000), 'nota-de-voz-1700000000000.ogg');
  assert.match(voiceNoteFileName('audio/webm'), /^nota-de-voz-\d+\.weba$/);
});

// --- Duraciones -------------------------------------------------------------

test('la duración se redondea y nunca baja de un segundo', () => {
  assert.equal(secondsFromMs(0), 1);
  assert.equal(secondsFromMs(400), 1);
  assert.equal(secondsFromMs(1400), 1);
  assert.equal(secondsFromMs(1500), 2);
  assert.equal(secondsFromMs(7000), 7);
});

test('una duración inválida no produce NaN', () => {
  assert.equal(secondsFromMs(undefined), 1);
  assert.equal(secondsFromMs(null), 1);
  assert.equal(secondsFromMs('hola'), 1);
});

test('el formato de la burbuja es m:ss', () => {
  assert.equal(formatDuration(7), '0:07');
  assert.equal(formatDuration(83), '1:23');
  assert.equal(formatDuration(600), '10:00');
  assert.equal(formatDuration(0), '0:00');
});

// --- Disponibilidad ---------------------------------------------------------

test('se puede grabar solo con MediaRecorder y getUserMedia', () => {
  const nav = { mediaDevices: { getUserMedia: () => {} } };
  assert.equal(canRecordAudio(nav, function Recorder() {}), true);
  assert.equal(canRecordAudio(nav, undefined), false);
  assert.equal(canRecordAudio({}, function Recorder() {}), false);
  assert.equal(canRecordAudio(undefined, function Recorder() {}), false);
});
