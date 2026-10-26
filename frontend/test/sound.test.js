import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOUND_KEY,
  readSoundOn,
  writeSoundOn,
  isMuted,
  shouldPauseFeed,
  listAudioOutputs,
  applySink,
  clampVolume,
  applyVolume,
  applyAudioSession,
} from '../src/lib/sound.js';

// Almacenamiento en memoria: en Node no existe localStorage, y lo que se prueba
// es la lógica real de sound.js, no el navegador.
function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    _store: store,
  };
}

test('por defecto el feed arranca silenciado', () => {
  assert.equal(readSoundOn(fakeStorage()), false);
});

test('la preferencia de sonido se guarda y se recupera', () => {
  const storage = fakeStorage();
  writeSoundOn(true, storage);
  assert.equal(storage._store.get(SOUND_KEY), 'true');
  assert.equal(readSoundOn(storage), true);

  writeSoundOn(false, storage);
  assert.equal(readSoundOn(storage), false);
});

test('un valor corrupto en el almacén no rompe el feed', () => {
  assert.equal(readSoundOn(fakeStorage({ [SOUND_KEY]: 'sí' })), false);
});

test('un almacén que falla no lanza: se asume silencio', () => {
  const broken = {
    getItem() {
      throw new Error('acceso denegado');
    },
    setItem() {
      throw new Error('acceso denegado');
    },
  };
  assert.equal(readSoundOn(broken), false);
  // Escribir tampoco debe propagar el error.
  assert.doesNotThrow(() => writeSoundOn(true, broken));
});

test('solo suena la tarjeta visible con el sonido activado', () => {
  assert.equal(isMuted(true, true), false);
  assert.equal(isMuted(true, false), true);
  assert.equal(isMuted(false, true), true);
  assert.equal(isMuted(false, false), true);
});

test('el feed se pausa con una llamada en curso', () => {
  // Sin llamada y en la pestaña de vídeos, el feed suena.
  assert.equal(shouldPauseFeed(false, 'idle'), false);
  // En Facetak (publicaciones) siempre se pausa.
  assert.equal(shouldPauseFeed(true, 'idle'), true);
  // Cualquier estado de llamada pausa el feed, aunque se siga viendo: es lo que
  // evita que el vídeo compita con la voz y que el volumen del móvil regule el
  // vídeo en vez de la llamada.
  for (const status of ['preparing', 'outgoing', 'incoming', 'active']) {
    assert.equal(shouldPauseFeed(false, status), true, `debería pausar en ${status}`);
  }
  // Un estado nulo (aún sin contexto) no debe dejar el feed sonando por error.
  assert.equal(shouldPauseFeed(false, undefined), true);
});

test('lista las salidas de audio del dispositivo', async () => {
  const mediaDevices = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'mic', label: 'Micrófono' },
      { kind: 'audiooutput', deviceId: 'spk', label: 'Altavoz' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Cámara' },
    ],
  };
  assert.deepEqual(await listAudioOutputs(mediaDevices), [
    { id: 'spk', label: 'Altavoz' },
  ]);
});

test('sin enumerateDevices no hay salidas y no se lanza', async () => {
  assert.deepEqual(await listAudioOutputs(null), []);
  assert.deepEqual(await listAudioOutputs({}), []);
});

test('applySink informa si no hay soporte en vez de fallar', async () => {
  assert.equal(await applySink(null, 'spk'), false);
  assert.equal(await applySink({}, 'spk'), false);
});

test('applySink usa setSinkId cuando existe', async () => {
  let used = null;
  const element = {
    setSinkId: async (id) => {
      used = id;
    },
  };
  assert.equal(await applySink(element, 'earpiece'), true);
  assert.equal(used, 'earpiece');
});

test('applySink devuelve false si el navegador rechaza la salida', async () => {
  const element = {
    setSinkId: async () => {
      throw new Error('NotFoundError');
    },
  };
  assert.equal(await applySink(element, 'inexistente'), false);
});

test('clampVolume mantiene el volumen dentro de [0, 1]', () => {
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume(0), 0);
  assert.equal(clampVolume(1), 1);
  // Fuera de rango: se recorta en vez de dejar un valor que el navegador
  // ignoraría y que haría parecer muerto el control.
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume('0.25'), 0.25);
  // Un valor no numérico cae al máximo: mejor sonar que quedar mudo.
  assert.equal(clampVolume('x'), 1);
  assert.equal(clampVolume(undefined), 1);
  assert.equal(clampVolume(null), 1);
});

test('applyVolume escribe el volumen acotado en el elemento', () => {
  const element = { volume: 1 };
  assert.equal(applyVolume(element, 0.3), 0.3);
  assert.equal(element.volume, 0.3);
  // Sin elemento no lanza: el control puede cambiar antes de que el audio
  // exista (por ejemplo, al aceptar la llamada).
  assert.equal(applyVolume(null, 0.5), 0.5);
  assert.doesNotThrow(() => applyVolume(undefined, 0.5));
});

test('applyAudioSession declara el tipo cuando la API existe', () => {
  const session = { type: 'auto' };
  assert.equal(applyAudioSession('play-and-record', { audioSession: session }), true);
  assert.equal(session.type, 'play-and-record');
});

test('applyAudioSession no falla si el navegador no la soporta', () => {
  assert.equal(applyAudioSession('play-and-record', {}), false);
  assert.equal(applyAudioSession('play-and-record', null), false);
  // Un navegador que expone la propiedad pero la rechaza tampoco debe romper la
  // llamada: se informa con false y la app sigue.
  const throwing = {
    audioSession: {
      set type(v) {
        throw new Error('no permitido');
      },
    },
  };
  assert.equal(applyAudioSession('play-and-record', throwing), false);
});
