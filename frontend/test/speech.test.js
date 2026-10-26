// Voz para la traducción en vivo: reconocimiento continuo, cola de síntesis y
// el flujo que une lo que se oye con lo que se dice.
//
// Se prueban con dobles de `SpeechRecognition` y `speechSynthesis` inyectados.
// No es por comodidad: es que el ciclo de vida del reconocedor (que se corta solo
// y hay que reiniciarlo, que `stop` sobre uno parado no es error) es justo donde
// se cometen los fallos, y eso no se puede probar en un navegador de verdad de
// forma fiable.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRecognize,
  canSynthesize,
  canTranslateCalls,
  createRecognizer,
  createSpeaker,
  createSpeechSender,
  createSpeechReceiver,
} from '../src/lib/speech.js';

// --- Dobles -----------------------------------------------------------------

// Reconocedor falso que se comporta como el real: se para solo y avisa.
function FakeRecognition() {
  FakeRecognition.instances.push(this);
  this.lang = '';
  this.continuous = false;
  this.interimResults = false;
  this.started = 0;
  this.stopped = 0;
  this.aborted = 0;
}
FakeRecognition.instances = [];
FakeRecognition.reset = () => {
  FakeRecognition.instances = [];
};

FakeRecognition.prototype.start = function start() {
  this.started += 1;
  // El motor real lanza si ya está arrancado.
  if (this.running) throw new Error('already started');
  this.running = true;
};
FakeRecognition.prototype.stop = function stop() {
  this.stopped += 1;
  this.running = false;
  this.onend?.();
};
FakeRecognition.prototype.abort = function abort() {
  this.aborted += 1;
  this.running = false;
};
// Ayudas para simular lo que llega del motor.
FakeRecognition.prototype.emitPartial = function emitPartial(text) {
  this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] });
};
FakeRecognition.prototype.emitFinal = function emitFinal(text) {
  const result = [{ transcript: text }];
  result.isFinal = true;
  this.onresult?.({ resultIndex: 0, results: [result] });
};
// El motor se corta solo tras un silencio.
FakeRecognition.prototype.silence = function silence() {
  this.running = false;
  this.onend?.();
};

// Sintetizador falso: registra lo que se le pide decir y deja terminar a mano.
function fakeSynth() {
  const spoken = [];
  return {
    spoken,
    speak(utterance) {
      spoken.push(utterance);
    },
    cancel() {
      spoken.length = 0;
    },
    // Termina la última frase, que dispara el `onend` y encadena la siguiente.
    finishLast() {
      spoken[spoken.length - 1]?.onend?.();
    },
  };
}

// `SpeechSynthesisUtterance` no existe en Node: se pone un doble global.
function withUtterance(fn) {
  const original = globalThis.SpeechSynthesisUtterance;
  globalThis.SpeechSynthesisUtterance = function Utterance() {
    this.text = '';
    this.lang = '';
    this.rate = 1;
  };
  try {
    return fn();
  } finally {
    globalThis.SpeechSynthesisUtterance = original;
  }
}

// --- Capacidades -------------------------------------------------------------

test('detecta si el navegador puede oír y hablar', () => {
  assert.equal(canRecognize(undefined), false);
  assert.equal(canRecognize(FakeRecognition), true);
  assert.equal(canSynthesize(undefined), false);
  assert.equal(canSynthesize(fakeSynth()), true);
});

test('la traducción en llamadas solo se ofrece si hay STT y TTS', () => {
  assert.equal(canTranslateCalls({ Recognition: FakeRecognition, synth: fakeSynth() }), true);
  // Solo TTS: se pueden oír traducciones entrantes pero no doblar la voz propia.
  assert.equal(canTranslateCalls({ Recognition: undefined, synth: fakeSynth() }), false);
  assert.equal(canTranslateCalls({ Recognition: FakeRecognition, synth: undefined }), false);
});

// --- Reconocedor -------------------------------------------------------------

test('sin soporte devuelve un objeto inerte, no un error', () => {
  const rec = createRecognizer({ Recognition: undefined, language: 'es' });
  assert.equal(rec.supported, false);
  // No debe lanzar: quien lo usa comprueba `supported` antes.
  rec.start();
  rec.stop();
  rec.destroy();
});

test('el reconocedor arranca en el idioma pedido', () => {
  FakeRecognition.reset();
  const rec = createRecognizer({ Recognition: FakeRecognition, language: 'zh-Hans' });
  assert.equal(rec.language, 'zh-CN');
  rec.start();
  assert.equal(FakeRecognition.instances[0].started, 1);
  assert.equal(FakeRecognition.instances[0].continuous, true);
  assert.equal(FakeRecognition.instances[0].interimResults, true);
});

test('se reinicia solo cuando el motor se corta por silencio', () => {
  FakeRecognition.reset();
  const rec = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  rec.start();
  const engine = FakeRecognition.instances[0];
  assert.equal(engine.started, 1);

  // El motor se para solo: si no se reiniciara, la llamada dejaría de traducir a
  // los pocos segundos.
  engine.silence();
  assert.equal(engine.started, 2);
});

test('no se reinicia después de pararlo a propósito', () => {
  FakeRecognition.reset();
  const rec = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  rec.start();
  const engine = FakeRecognition.instances[0];
  rec.stop();
  assert.equal(engine.stopped, 1);
  // El `onend` que dispara `stop` no debe volver a arrancarlo.
  assert.equal(engine.started, 1);
});

test('un start repetido no lanza ni duplica la escucha', () => {
  FakeRecognition.reset();
  const rec = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  rec.start();
  rec.start();
  const engine = FakeRecognition.instances[0];
  assert.equal(engine.started, 1, 'el segundo start debe ignorarse');
});

test('entrega el texto provisional y el final por separado', () => {
  FakeRecognition.reset();
  const partials = [];
  const finals = [];
  createRecognizer({
    Recognition: FakeRecognition,
    language: 'es',
    onPartial: (t) => partials.push(t),
    onFinal: (t) => finals.push(t),
  });
  const engine = FakeRecognition.instances[0];
  engine.emitPartial('hola');
  engine.emitFinal('hola, ¿cómo estás?');
  assert.deepEqual(partials, ['hola']);
  assert.deepEqual(finals, ['hola, ¿cómo estás?']);
});

test('ignora el silencio y el aborto, que son normales', () => {
  FakeRecognition.reset();
  const errors = [];
  createRecognizer({
    Recognition: FakeRecognition,
    language: 'es',
    onError: (e) => errors.push(e),
  });
  const engine = FakeRecognition.instances[0];
  engine.onerror?.({ error: 'no-speech' });
  engine.onerror?.({ error: 'aborted' });
  assert.deepEqual(errors, []);

  // Un permiso denegado sí es un fallo que hay que contar.
  engine.onerror?.({ error: 'not-allowed' });
  assert.deepEqual(errors, ['not-allowed']);
});

test('destroy cierra el micrófono y no lo reabre', () => {
  FakeRecognition.reset();
  const rec = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  rec.start();
  const engine = FakeRecognition.instances[0];
  rec.destroy();
  assert.equal(engine.aborted, 1);
  engine.silence();
  assert.equal(engine.started, 1, 'no debe reabrirse tras destroy');
  rec.start();
  assert.equal(engine.started, 1);
});

test('cambiar de idioma actualiza el motor', () => {
  FakeRecognition.reset();
  const rec = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  rec.setLanguage('zh-Hans');
  assert.equal(rec.language, 'zh-CN');
});

// --- Sintetizador ------------------------------------------------------------

test('sin soporte de síntesis devuelve un objeto inerte', () => {
  const speaker = createSpeaker({ synth: undefined });
  assert.equal(speaker.supported, false);
  speaker.say('hola', 'es');
  speaker.stop();
  assert.equal(speaker.pending, 0);
});

test('dice las frases en orden, sin pisarse', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const speaker = createSpeaker({ synth, voices: () => [] });

    speaker.say('primera', 'es');
    speaker.say('segunda', 'es');

    // Solo la primera se ha pedido al motor: la segunda espera su turno. Sin esta
    // cola, la segunda cortaría a la primera y solo se oiría el final.
    assert.equal(synth.spoken.length, 1);
    assert.equal(synth.spoken[0].text, 'primera');

    synth.finishLast();
    assert.equal(synth.spoken.length, 2);
    assert.equal(synth.spoken[1].text, 'segunda');
  });
});

test('el idioma de la frase decide la voz', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const voices = [{ lang: 'zh-CN', name: 'Mandarín' }];
    const speaker = createSpeaker({ synth, voices: () => voices });
    speaker.say('你好', 'zh-Hans');
    assert.equal(synth.spoken[0].lang, 'zh-CN');
    assert.equal(synth.spoken[0].voice.name, 'Mandarín');
  });
});

test('un texto vacío no se dice', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const speaker = createSpeaker({ synth, voices: () => [] });
    speaker.say('', 'es');
    speaker.say('   ', 'es');
    assert.equal(synth.spoken.length, 0);
    assert.equal(speaker.pending, 0);
  });
});

test('avisar del principio y del final del habla', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const events = [];
    const speaker = createSpeaker({
      synth,
      voices: () => [],
      onStart: () => events.push('start'),
      onEnd: () => events.push('end'),
    });

    speaker.say('hola', 'es');
    assert.deepEqual(events, ['start']);
    synth.finishLast();
    assert.deepEqual(events, ['start', 'end']);
  });
});

test('el altavoz sabe si está hablando', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const speaker = createSpeaker({ synth, voices: () => [] });

    assert.equal(speaker.speaking, false);
    speaker.say('hola', 'es');
    // Mientras hay algo en la boca, la pantalla atenúa la voz del otro y el
    // emisor no manda lo que oiga.
    assert.equal(speaker.speaking, true);
    synth.finishLast();
    assert.equal(speaker.speaking, false);
  });
});

test('un motor que no avisa del final no deja el micrófono cerrado para siempre', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const events = [];
    const speaker = createSpeaker({
      synth,
      voices: () => [],
      onStart: () => events.push('start'),
      onEnd: () => events.push('end'),
    });

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let fire = null;
    globalThis.setTimeout = (fn) => {
      fire = fn;
      return 1;
    };
    globalThis.clearTimeout = () => {};

    try {
      speaker.say('una frase que nunca termina', 'es');
      // El motor no llama a `onend`. El vigilante tiene que dispararse solo y
      // devolver `speaking` a falso, o el emisor se quedaría mudo el resto de la
      // llamada esperando un aviso que no llega.
      assert.equal(speaker.speaking, true);
      fire?.();
      assert.equal(speaker.speaking, false);
      assert.deepEqual(events, ['start', 'end']);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});

test('stop corta y vacía la cola', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const speaker = createSpeaker({ synth, voices: () => [] });
    speaker.say('una', 'es');
    speaker.say('dos', 'es');
    speaker.stop();
    assert.equal(speaker.pending, 0);
    assert.equal(synth.spoken.length, 0, 'cancel debe vaciar lo pendiente');
  });
});

test('una frase que falla no deja muda la llamada', () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const speaker = createSpeaker({ synth, voices: () => [] });
    speaker.say('una', 'es');
    speaker.say('dos', 'es');
    // La primera falla al sintetizar: la segunda debe seguir sonando.
    synth.spoken[0].onerror?.();
    assert.equal(synth.spoken.length, 2);
    assert.equal(synth.spoken[1].text, 'dos');
  });
});

// --- Emisor de voz (lo que digo yo) ------------------------------------------

test('sin reconocedor o sin canal de envío, el emisor no se ofrece', () => {
  assert.equal(createSpeechSender({}).supported, false);
  const rec = { start() {}, stop() {}, destroy() {}, setHandlers() {} };
  assert.equal(createSpeechSender({ recognizer: rec }).supported, false);
  assert.equal(createSpeechSender({ recognizer: rec, send: () => {} }).supported, true);
});

test('manda el texto reconocido, sin traducirlo', async () => {
  FakeRecognition.reset();
  const sent = [];
  const captions = [];
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  const sender = createSpeechSender({
    recognizer,
    send: (payload) => sent.push(payload),
    onCaption: (c) => captions.push(c),
  });

  assert.equal(sender.supported, true);
  FakeRecognition.instances[0].emitFinal('Hola, ¿cómo estás?');
  await new Promise((r) => setImmediate(r));

  // Se manda el texto tal cual: quien traduce es el receptor, que sabe su idioma.
  assert.deepEqual(sent, [{ type: 'speech', text: 'Hola, ¿cómo estás?' }]);
  assert.equal(captions[0].original, 'Hola, ¿cómo estás?');
  assert.equal(captions[0].mine, true);
});

test('no manda la misma frase dos veces', async () => {
  FakeRecognition.reset();
  const sent = [];
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  createSpeechSender({ recognizer, send: (p) => sent.push(p) });

  FakeRecognition.instances[0].emitFinal('Hola');
  await new Promise((r) => setImmediate(r));
  FakeRecognition.instances[0].emitFinal('Hola');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);

  FakeRecognition.instances[0].emitFinal('Adiós');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 2);
});

test('destroy para el reconocedor del emisor', () => {
  FakeRecognition.reset();
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  const sender = createSpeechSender({ recognizer, send: () => {} });
  sender.start();
  sender.destroy();
  assert.equal(FakeRecognition.instances[0].aborted, 1);
});

test('no reenvía su propia traducción mientras el altavoz habla', async () => {
  FakeRecognition.reset();
  const sent = [];
  let speaking = true;
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  createSpeechSender({
    recognizer,
    send: (p) => sent.push(p),
    isSpeaking: () => speaking,
  });

  // Esto es lo que oiría el micrófono del altavoz diciendo la traducción. Si se
  // mandara, el otro la volvería a traducir y la llamada entraría en bucle.
  FakeRecognition.instances[0].emitFinal('Hola, ¿cómo estás?');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 0, 'no debe salir nada mientras habla el altavoz');

  // Cuando el altavoz calla, mi voz vuelve a mandarse.
  speaking = false;
  FakeRecognition.instances[0].emitFinal('¿Me oyes?');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '¿Me oyes?');
});

test('pause cierra el micrófono y resume lo reabre', async () => {
  FakeRecognition.reset();
  const sent = [];
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  const sender = createSpeechSender({ recognizer, send: (p) => sent.push(p) });
  sender.start();

  const engine = FakeRecognition.instances[0];
  const startedBefore = engine.started;

  sender.pause();
  assert.equal(engine.running, false, 'el micrófono debe quedar cerrado');

  // Una frase que llega con el micrófono cerrado no se manda ni aunque el
  // altavoz ya haya terminado: es la frase rezagada que oyó antes de cerrar.
  engine.emitFinal('esto lo dijo el altavoz');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 0);

  sender.resume();
  assert.equal(engine.running, true, 'el micrófono debe reabrirse');
  assert.ok(engine.started > startedBefore);

  engine.emitFinal('ahora sí es mi voz');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
});

test('pausar dos veces no duplica la reapertura', () => {
  FakeRecognition.reset();
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  const sender = createSpeechSender({ recognizer, send: () => {} });
  sender.start();
  const engine = FakeRecognition.instances[0];

  sender.pause();
  sender.pause();
  assert.equal(engine.running, false);
  sender.resume();
  const afterFirstResume = engine.started;
  sender.resume();
  assert.equal(engine.started, afterFirstResume, 'un resume repetido no arranca otra vez');
});

test('tras stop, un resume del altavoz no reabre el micrófono', () => {
  FakeRecognition.reset();
  const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
  const sender = createSpeechSender({ recognizer, send: () => {} });
  sender.start();
  const engine = FakeRecognition.instances[0];

  // Al apagar la traducción se para el emisor y luego el altavoz; el `onEnd` del
  // altavoz llama a `resume`. Si reabriera, el micrófono quedaría escuchando tras
  // apagar la función, que es justo lo que no debe pasar.
  sender.stop();
  sender.resume();
  assert.equal(engine.running, false, 'el micrófono debe seguir cerrado');
});

// --- Receptor de voz (lo que dice el otro) -----------------------------------

test('sin altavoz o sin traductor, el receptor no se ofrece', () => {
  assert.equal(createSpeechReceiver({}).supported, false);
  assert.equal(createSpeechReceiver({ speaker: { say() {} } }).supported, false);
  assert.equal(
    createSpeechReceiver({ speaker: { say() {} }, translate: async () => ({}) }).supported,
    true
  );
});

test('el receptor traduce a mi idioma y lo dice', async () => {
  const said = [];
  const captions = [];
  const receiver = createSpeechReceiver({
    targetLanguage: 'zh-Hans',
    translate: async ({ text, to }) => ({
      text: '你好，你好吗？',
      source: 'es',
      target: to,
      translated: true,
    }),
    speaker: { say: (text, lang) => said.push({ text, lang }), stop() {} },
    onCaption: (c) => captions.push(c),
  });

  assert.equal(receiver.supported, true);
  receiver.handle('Hola, ¿cómo estás?');
  await new Promise((r) => setImmediate(r));

  assert.equal(said.length, 1);
  assert.equal(said[0].text, '你好，你好吗？');
  assert.equal(said[0].lang, 'zh-Hans');
  assert.equal(captions[0].original, 'Hola, ¿cómo estás?');
  assert.equal(captions[0].translated, '你好，你好吗？');
});

test('el receptor aprende el idioma del otro y lo usa de pista', async () => {
  const hints = [];
  const receiver = createSpeechReceiver({
    targetLanguage: 'es',
    translate: async ({ hint, to }) => {
      hints.push(hint);
      return { text: 'hola', source: 'zh-Hans', target: to, translated: true };
    },
    speaker: { say() {}, stop() {} },
  });

  receiver.handle('你好');
  await new Promise((r) => setImmediate(r));
  receiver.handle('再见');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(hints, [null, 'zh-Hans']);
});

test('el receptor mantiene el orden de las frases', async () => {
  const said = [];
  const receiver = createSpeechReceiver({
    targetLanguage: 'en',
    // La primera traducción tarda más que la segunda: si se hicieran en paralelo,
    // llegarían al revés y la conversación se oiría desordenada.
    translate: async ({ text }) => {
      if (text === 'primera') await new Promise((r) => setTimeout(r, 20));
      return { text: `[${text}]`, source: 'es', target: 'en', translated: true };
    },
    speaker: { say: (t) => said.push(t), stop() {} },
  });

  receiver.handle('primera');
  receiver.handle('segunda');
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(said, ['[primera]', '[segunda]']);
});

test('el receptor no dice nada si no hubo traducción', async () => {
  const said = [];
  const captions = [];
  const receiver = createSpeechReceiver({
    targetLanguage: 'es',
    translate: async ({ text, to }) => ({ text, source: 'es', target: to, translated: false }),
    speaker: { say: (t) => said.push(t), stop() {} },
    onCaption: (c) => captions.push(c),
  });

  receiver.handle('Hola');
  await new Promise((r) => setImmediate(r));
  assert.equal(said.length, 0, 'no se repite por el altavoz lo que ya se oyó');
  assert.equal(captions[0].translated, null);
});

test('un fallo de traducción en el receptor se avisa y no rompe la llamada', async () => {
  const errors = [];
  const receiver = createSpeechReceiver({
    targetLanguage: 'en',
    translate: async () => {
      throw new Error('cuota agotada');
    },
    speaker: { say() {}, stop() {} },
    onError: (e) => errors.push(e),
  });

  receiver.handle('Hola');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ['cuota agotada']);

  // Y una frase posterior sigue funcionando: el error no deja la cadena rota.
  receiver.handle('Adiós');
  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 2);
});

test('el receptor corta la voz al destruirse', () => {
  let stopped = 0;
  const receiver = createSpeechReceiver({
    targetLanguage: 'en',
    translate: async () => ({ translated: false }),
    speaker: { say() {}, stop: () => { stopped += 1; } },
  });
  receiver.destroy();
  assert.equal(stopped, 1);
});

test('el destino del receptor se puede cambiar en mitad de la llamada', async () => {
  const targets = [];
  const receiver = createSpeechReceiver({
    targetLanguage: 'en',
    translate: async ({ to }) => {
      targets.push(to);
      return { text: 'x', source: 'es', target: to, translated: true };
    },
    speaker: { say() {}, stop() {} },
  });
  receiver.setTargetLanguage('zh-Hans');
  receiver.handle('Hola');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(targets, ['zh-Hans']);
});

// --- Eco: el ciclo completo emisor + altavoz ---------------------------------

test('mientras el altavoz habla, el emisor no reenvía lo que oye', () => {
  withUtterance(() => {
    FakeRecognition.reset();
    const sent = [];
    const recognizer = createRecognizer({ Recognition: FakeRecognition, language: 'es' });
    const synth = fakeSynth();
    const speaker = createSpeaker({ synth, voices: () => [] });

    // Así se cablea en `CallContext`: el altavoz cierra el micrófono al empezar a
    // hablar y lo reabre al terminar, y el emisor además descarta lo que llegue
    // con el altavoz todavía en la boca.
    const sender = createSpeechSender({
      recognizer,
      send: (p) => sent.push(p),
      isSpeaking: () => speaker.speaking,
    });
    sender.start();

    const engine = FakeRecognition.instances[0];
    // Llega una traducción del otro: el altavoz empieza a hablar.
    speaker.say('Hello, how are you?', 'en');
    assert.equal(speaker.speaking, true);

    // El micrófono, si estuviera abierto, oiría esa voz. No debe salir nada, o el
    // otro la volvería a traducir y la llamada entraría en bucle.
    engine.emitFinal('Hello, how are you?');
    assert.equal(sent.length, 0, 'la traducción no puede volver al otro como si fuera mía');

    // Al callar el altavoz, mi voz vuelve a mandarse.
    synth.finishLast();
    assert.equal(speaker.speaking, false);
    engine.emitFinal('¿Me oyes?');
    assert.deepEqual(sent, [{ type: 'speech', text: '¿Me oyes?' }]);
  });
});
