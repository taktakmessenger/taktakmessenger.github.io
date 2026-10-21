import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOUND_KEY,
  readSoundOn,
  writeSoundOn,
  isMuted,
  listAudioOutputs,
  applySink,
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
