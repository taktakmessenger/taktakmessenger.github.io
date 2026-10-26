import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaErrorMessage } from '../src/lib/mediaErrors.js';

// Lo que se prueba es la regla que arregló el fallo: el `name` de la excepción
// manda, y el mensaje del navegador (en inglés) nunca llega al usuario.

test('el permiso denegado se explica y dice qué hacer', () => {
  const err = new DOMException('Permission denied', 'NotAllowedError');
  const msg = mediaErrorMessage(err);
  assert.match(msg, /permiso/i);
  assert.match(msg, /ajustes del navegador/i);
  assert.doesNotMatch(msg, /permission denied/i);
});

test('el permiso denegado también por su nombre antiguo', () => {
  const err = Object.assign(new Error('denied'), { name: 'PermissionDeniedError' });
  assert.match(mediaErrorMessage(err), /permiso/i);
});

test('no hay dispositivo', () => {
  const err = new DOMException('Requested device not found', 'NotFoundError');
  assert.match(mediaErrorMessage(err), /no se encontró/i);
});

test('el dispositivo está ocupado por otra app', () => {
  const err = new DOMException('Could not start', 'NotReadableError');
  assert.match(mediaErrorMessage(err), /otra aplicación/i);
});

test('la cámara pedida no existe', () => {
  const err = new DOMException('', 'OverconstrainedError');
  assert.match(mediaErrorMessage(err), /no tiene la cámara/i);
});

test('el navegador bloqueó el acceso', () => {
  const err = new DOMException('', 'SecurityError');
  assert.match(mediaErrorMessage(err), /bloqueó/i);
});

test('un error desconocido cae en un mensaje genérico en español', () => {
  const err = new DOMException('Weird internal failure', 'WeirdError');
  const msg = mediaErrorMessage(err);
  assert.equal(msg, 'No se pudo acceder a la cámara o al micrófono.');
  assert.doesNotMatch(msg, /weird/i);
});

test('sin error también hay mensaje, no se lanza', () => {
  assert.equal(mediaErrorMessage(null), 'No se pudo acceder a la cámara o al micrófono.');
  assert.equal(mediaErrorMessage(undefined), 'No se pudo acceder a la cámara o al micrófono.');
});

test('un error sin nombre conocido cae en el genérico', () => {
  const err = new Error('Tu navegador no permite llamadas');
  // El traductor solo conoce los nombres de la spec. El texto propio lo pone
  // `acquireMedia` antes de llegar aquí, no se pasa por el traductor.
  assert.equal(mediaErrorMessage(err), 'No se pudo acceder a la cámara o al micrófono.');
});
