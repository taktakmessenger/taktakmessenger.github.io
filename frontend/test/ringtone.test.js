import test from 'node:test';
import assert from 'node:assert/strict';
import { startRingtone, stopRingtone, unlockAudio, isRinging } from '../src/lib/ringtone.js';

// Estos tests usan un doble del contexto de audio y de la vibración: lo que se
// prueba es la lógica real de ringtone.js (que arranca, que para y que no apila
// tonos), no que el navegador emita sonido. En Node no hay Web Audio ni
// navigator.vibrate, así que se sustituyen en el objeto global.

function withFakeAudio() {
  // ringtone.js cachea su AudioContext a nivel de módulo, así que todos los
  // tests comparten una instancia. El registro de lo que pasa va en un objeto
  // global para que cada test lea los arranques reales, no los del anterior.
  const recorder = { started: 0, timers: 0, vibrations: [] };
  globalThis.__ringRecorder = recorder;

  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 0 },
        connect() {},
        // Lee el registro vigente en el momento de sonar: el contexto queda
        // cacheado entre tests, así que no puede capturar el de uno concreto.
        start() { globalThis.__ringRecorder.started += 1; },
        stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
      };
    }
    resume() { return Promise.resolve(); }
  }

  const originalCtx = globalThis.AudioContext;
  const originalWebkit = globalThis.webkitAudioContext;
  const originalVibrate = globalThis.navigator?.vibrate;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  globalThis.AudioContext = FakeAudioContext;
  globalThis.setInterval = () => {
    recorder.timers += 1;
    return { id: recorder.timers };
  };
  globalThis.clearInterval = () => { recorder.timers -= 1; };

  if (globalThis.navigator) {
    globalThis.navigator.vibrate = (pattern) => {
      recorder.vibrations.push(pattern);
      return true;
    };
  }

  return {
    recorder,
    restore() {
      globalThis.AudioContext = originalCtx;
      globalThis.webkitAudioContext = originalWebkit;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      if (globalThis.navigator) globalThis.navigator.vibrate = originalVibrate;
      delete globalThis.__ringRecorder;
    },
  };
}

test('el tono entrante arranca osciladores y vibra', () => {
  const fake = withFakeAudio();
  try {
    startRingtone('incoming');
    // El patrón entrante son dos tonos (doble timbre).
    assert.ok(fake.recorder.started >= 2, 'debería sonar el doble timbre');
    assert.deepEqual(fake.recorder.vibrations[0], [400, 200, 400, 200]);
  } finally {
    stopRingtone();
    fake.restore();
  }
});

test('el tono saliente usa un patrón distinto del entrante', () => {
  const fake = withFakeAudio();
  try {
    startRingtone('outgoing');
    assert.equal(fake.recorder.started, 1, 'el tono saliente es un solo pitido');
    assert.deepEqual(fake.recorder.vibrations[0], [200]);
  } finally {
    stopRingtone();
    fake.restore();
  }
});

test('stopRingtone cancela los temporizadores', () => {
  const fake = withFakeAudio();
  try {
    startRingtone('incoming');
    assert.ok(fake.recorder.timers >= 1);
    stopRingtone();
    assert.equal(fake.recorder.timers, 0, 'no debe quedar ningún intervalo vivo');
  } finally {
    fake.restore();
  }
});

test('llamar dos veces a startRingtone no apila tonos', () => {
  const fake = withFakeAudio();
  try {
    startRingtone('incoming');
    const afterFirst = fake.recorder.timers;
    startRingtone('incoming');
    assert.equal(fake.recorder.timers, afterFirst, 'el segundo arranque reemplaza al primero');
  } finally {
    stopRingtone();
    fake.restore();
  }
});

test('stopRingtone sin tono activo no falla', () => {
  assert.doesNotThrow(() => stopRingtone());
});

test('isRinging refleja el estado real del timbre', () => {
  const fake = withFakeAudio();
  try {
    assert.equal(isRinging(), null, 'en reposo no hay tono');
    startRingtone('incoming');
    assert.equal(isRinging(), 'incoming');
    startRingtone('outgoing');
    assert.equal(isRinging(), 'outgoing', 'un tono nuevo reemplaza al anterior');
    stopRingtone();
    assert.equal(isRinging(), null, 'al parar no queda tono');
  } finally {
    fake.restore();
  }
});

test('el arranque y la parada del tono emiten un evento observable', () => {
  const fake = withFakeAudio();
  // Node no tiene `globalThis` como destino de eventos, así que se instala un
  // bus mínimo: es justo el que usa `announce` si existe.
  const events = [];
  const listeners = new Set();
  const originalDispatch = globalThis.dispatchEvent;
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (type, fn) => listeners.add(fn);
  globalThis.removeEventListener = (type, fn) => listeners.delete(fn);
  globalThis.dispatchEvent = (event) => {
    listeners.forEach((fn) => fn(event));
    return true;
  };
  globalThis.addEventListener('taktak:ringtone', (e) => events.push(e.detail.ringing));
  try {
    startRingtone('incoming');
    stopRingtone();
    assert.deepEqual(events, ['incoming', null]);
  } finally {
    globalThis.dispatchEvent = originalDispatch;
    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
    fake.restore();
  }
});

test('unlockAudio no falla aunque no haya Web Audio', () => {
  const originalCtx = globalThis.AudioContext;
  const originalWebkit = globalThis.webkitAudioContext;
  globalThis.AudioContext = undefined;
  globalThis.webkitAudioContext = undefined;
  try {
    assert.doesNotThrow(() => unlockAudio());
  } finally {
    globalThis.AudioContext = originalCtx;
    globalThis.webkitAudioContext = originalWebkit;
  }
});
