// Voz del navegador para la traducción en vivo de WhaTaka: reconocer lo que se
// dice (STT) y volver a decirlo en el otro idioma (TTS).
//
// Por qué en el navegador y no en el servidor
// -------------------------------------------
// La traducción de una llamada necesita tres pasos: oír, traducir y hablar. El
// del medio es el único que hace falta que sea un servicio de pago; los otros dos
// los sabe hacer el propio navegador (`SpeechRecognition` y `SpeechSynthesis`) y
// van en el dispositivo. Eso tiene tres consecuencias que importan:
//
//   - El audio de la llamada nunca sale del dispositivo para transcribirlo. En
//     una app de mensajería, mandar las conversaciones a un tercero es una
//     decisión que no se toma por comodidad.
//   - No cuesta dinero por minuto, así que la función puede estar encendida.
//   - Funciona hoy, sin contratar nada. El día que se quiera un proveedor mejor,
//     el servidor puede hacer el STT/TTS (ver `TRANSLATE_VOICE_MODE=server`) y
//     este archivo queda como respaldo.
//
// El coste es que depende del navegador: `SpeechRecognition` solo existe en los
// basados en Chromium, y `SpeechSynthesis` existe en todos pero las voces
// instaladas varían. Por eso todo aquí está escrito para degradar: si no hay STT,
// la llamada sigue funcionando en su idioma; si no hay voz para un idioma, se
// enseñan subtítulos en vez de sintetizar mal.
//
// El archivo es lógica pura con las dependencias inyectadas (`Recognition`,
// `synth`, `voices`), para poder probar sin navegador, que es donde de verdad se
// cometen los errores: en la elección de voz y en el control del ciclo de escucha.

import { speechLocale, pickVoice, normalizeLanguage } from './translate.js';

// ¿Puede este navegador oír para traducir?
export function canRecognize(Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) {
  return typeof Recognition === 'function';
}

// ¿Puede hablar?
export function canSynthesize(synth = globalThis.speechSynthesis) {
  return Boolean(synth && typeof synth.speak === 'function');
}

// ¿Puede hacer las dos cosas? Solo entonces tiene sentido ofrecer la traducción
// en vivo en una llamada; si no, se ofrece solo el chat traducido.
export function canTranslateCalls(options = {}) {
  return canRecognize(options.Recognition) && canSynthesize(options.synth);
}

/**
 * Crea un reconocedor continuo para un idioma.
 *
 * El reconocimiento de voz se corta solo (por silencio, o a los pocos segundos en
 * algunos navegadores), así que hay que reiniciarlo. Eso es lo que convierte esto
 * en algo con estado y no en una simple llamada: `start`/`stop` se pisan entre sí
 * y sin un control explícito el micrófono se queda abierto después de colgar, o
 * deja de escuchar a mitad de frase.
 *
 * Devuelve un objeto con `start()`, `stop()`, `setLanguage()` y `destroy()`, y
 * avisa por los callbacks:
 *   onPartial(text)  texto provisional, mientras se habla
 *   onFinal(text)    frase cerrada, lista para traducir
 *   onError(err)     fallo (permiso denegado, sin red en algunos motores)
 */
export function createRecognizer({
  Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
  language,
  onPartial,
  onFinal,
  onError,
} = {}) {
  if (!canRecognize(Recognition)) {
    return {
      supported: false,
      start() {},
      stop() {},
      setLanguage() {},
      setHandlers() {},
      destroy() {},
    };
  }

  const locale = speechLocale(language) || 'en-US';
  const recognition = new Recognition();
  recognition.lang = locale;
  recognition.continuous = true;
  // Los resultados provisionales son lo que permite traducir mientras la persona
  // habla en vez de esperar a que calle. Sin ellos, una frase larga llega entera
  // al final y el retardo se nota.
  recognition.interimResults = true;

  // Los manejadores van en una caja y no en variables sueltas porque quien
  // traduce la llamada (`createIncomingTranslator`) recibe un reconocedor ya
  // creado y necesita engancharse a él. Sin esto, el reconocedor y el traductor
  // serían dos piezas sin cable entre ellas: se oiría pero no se traduciría.
  const handlers = { onPartial, onFinal, onError };

  let wanted = false; // ¿queremos estar escuchando?
  let running = false; // ¿está escuchando de verdad?
  let destroyed = false;

  recognition.onresult = (event) => {
    // Se recorre desde `resultIndex`: los resultados anteriores ya se
    // entregaron, y volver a leerlos repetiría frases ya traducidas.
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (!text) continue;
      if (result.isFinal) handlers.onFinal?.(text);
      else handlers.onPartial?.(text);
    }
  };

  recognition.onerror = (event) => {
    // `no-speech` y `aborted` son el funcionamiento normal (silencio, o nosotros
    // parando), no fallos que haya que enseñar.
    const code = event?.error;
    if (code && code !== 'no-speech' && code !== 'aborted') handlers.onError?.(code);
  };

  recognition.onend = () => {
    running = false;
    // El motor se para solo tras un silencio. Si seguimos queriendo escuchar, se
    // reinicia; si no, se queda parado. Sin esta comprobación, el reconocimiento
    // deja de funcionar a los pocos segundos de empezar la llamada.
    if (wanted && !destroyed) {
      try {
        recognition.start();
        running = true;
      } catch {
        // Un `start` sobre uno ya arrancado lanza; se ignora porque el estado ya
        // es el que queremos.
        running = true;
      }
    }
  };

  return {
    supported: true,
    start() {
      if (destroyed) return;
      wanted = true;
      if (running) return;
      try {
        recognition.start();
        running = true;
      } catch {
        running = true;
      }
    },
    stop() {
      wanted = false;
      if (!running) return;
      try {
        recognition.stop();
      } catch {
        // Parar un reconocedor ya parado no es un error.
      }
      running = false;
    },
    setLanguage(next) {
      const nextLocale = speechLocale(next);
      if (nextLocale) recognition.lang = nextLocale;
    },
    setHandlers(next = {}) {
      Object.assign(handlers, next);
    },
    destroy() {
      destroyed = true;
      wanted = false;
      try {
        recognition.abort();
      } catch {
        // Nada que hacer: el objeto se descarta igual.
      }
      running = false;
    },
    get language() {
      return recognition.lang;
    },
  };
}

/**
 * Cola de síntesis: dice las traducciones una detrás de otra, sin pisarse.
 *
 * Una llamada traducida produce frases cada pocos segundos. Si cada una llamara a
 * `speak` sin más, la segunda cortaría a la primera (el sintetizador es una sola
 * voz) y solo se oiría el final de cada frase. De ahí la cola: lo que se dice es
 * lo que se dijo, completo.
 *
 * `onStart`/`onEnd` sirven para bajar el volumen de la llamada mientras habla la
 * voz sintetizada: si no, la traducción se mezcla con la voz original y no se
 * entiende ninguna de las dos.
 */
export function createSpeaker({
  synth = globalThis.speechSynthesis,
  voices = () => globalThis.speechSynthesis?.getVoices?.() || [],
  onStart,
  onEnd,
} = {}) {
  if (!canSynthesize(synth)) {
    return { supported: false, say() {}, stop() {}, flush() {}, get pending() { return 0; }, get speaking() { return false; } };
  }

  const queue = [];
  let speaking = false;
  let current = null;
  // Vigilante por si el motor no avisa del final. Algunos navegadores no
  // disparan `onend` (sobre todo si se canceló), y como `speaking` cierra el
  // micrófono del emisor, quedarse en `true` dejaría al usuario mudo el resto de
  // la llamada. El tope es holgado —el doble de lo que tardaría una persona— para
  // no cortar una frase lenta de verdad.
  let watchdog = null;

  function clearWatchdog() {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function next() {
    clearWatchdog();
    if (queue.length === 0) {
      speaking = false;
      current = null;
      onEnd?.();
      return;
    }

    const item = queue.shift();
    const utterance = new (globalThis.SpeechSynthesisUtterance || function () {})();
    utterance.text = item.text;
    const locale = speechLocale(item.language);
    if (locale) utterance.lang = locale;
    const voice = pickVoice(voices(), item.language);
    if (voice) utterance.voice = voice;
    // Un poco más lento que el habla normal: una frase traducida se oye por
    // primera vez y con acento, así que a velocidad nativa se pierde.
    utterance.rate = item.rate ?? 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      current = null;
      next();
    };
    utterance.onerror = () => {
      // Si una frase falla, la cola sigue: perder una frase es mejor que
      // quedarse mudo el resto de la llamada.
      current = null;
      next();
    };

    // ~14 caracteres por segundo a velocidad normal, con un mínimo de 4 s y un
    // techo de 30 s: una frase de 60 caracteres da 8,5 s.
    const estimate = Math.min(30000, Math.max(4000, (item.text.length / 14) * 1000 / (item.rate || 1)));
    watchdog = setTimeout(() => {
      watchdog = null;
      current = null;
      next();
    }, estimate * 2);

    current = utterance;
    try {
      synth.speak(utterance);
    } catch {
      current = null;
      next();
    }
  }

  return {
    supported: true,
    /** Encola un texto para decirlo en `language`. */
    say(text, language, options = {}) {
      const clean = String(text ?? '').trim();
      if (!clean) return;
      queue.push({ text: clean, language, rate: options.rate });
      if (!speaking) {
        speaking = true;
        onStart?.();
        next();
      }
    },
    /** Corta lo que se está diciendo y vacía la cola. Se llama al colgar. */
    stop() {
      clearWatchdog();
      queue.length = 0;
      try {
        synth.cancel();
      } catch {
        // Cancelar sin nada en curso no es un error.
      }
      current = null;
      speaking = false;
      onEnd?.();
    },
    /** Vacía la cola sin cortar la frase en curso (por ejemplo, si la red falla). */
    flush() {
      queue.length = 0;
    },
    get pending() {
      return queue.length + (speaking ? 1 : 0);
    },
    /** ¿Está el altavoz diciendo algo ahora mismo (o a punto de)? */
    get speaking() {
      return speaking;
    },
  };
}

/**
 * Captura de la voz propia para una llamada traducida.
 *
 * Reconoce lo que digo YO y manda el TEXTO al otro lado. No lo traduce aquí, y
 * eso es una decisión de diseño, no una omisión: el que traduce es quien recibe,
 * porque el idioma de destino es el suyo y lo conoce con certeza. Si tradujera el
 * emisor, tendría que adivinar en qué idioma quiere leer el otro; así, cada uno
 * pide la traducción a su propio idioma y no hay nada que adivinar.
 *
 * Tampoco manda audio: el texto ocupa nada, y el otro lo dice con la voz de su
 * propio sistema, que es la que tiene instalada y la que suena bien en su
 * dispositivo. Mandar audio sintetizado gastaría ancho de banda para sonar peor.
 *
 * El reconocimiento se hace sobre MI micrófono, no sobre el audio que llega del
 * otro: mi voz se oye limpia en mi dispositivo, y así no hace falta reproducir
 * nada en alto para que el micrófono lo capture (que es lo que falla con
 * auriculares).
 */
export function createSpeechSender({
  recognizer,
  send,
  onCaption,
  onError,
  isSpeaking,
} = {}) {
  if (!recognizer || typeof send !== 'function') {
    return { supported: false, start() {}, stop() {}, destroy() {} };
  }

  let destroyed = false;
  // ¿Sigue encendida la traducción? `pause`/`resume` son del ciclo hablar/oír y
  // solo valen mientras lo está. Arranca encendida (quien crea el emisor es
  // porque quiere escuchar) y `stop()` la apaga. Sin este distintivo, al apagar
  // la traducción el `stop` del altavoz dispararía un `resume` que reabriría el
  // micrófono justo cuando el usuario acaba de pedir que se cierre.
  let active = true;
  // Evita mandar dos veces la misma frase: el motor puede entregarla como
  // provisional y como final, y a veces repite el final.
  let lastSent = '';
  let lastAt = 0;
  // Mientras el altavoz habla, el micrófono se cierra (`paused`). No basta con
  // descartar la frase al enviarla: el reconocedor tarda un poco en cerrar un
  // resultado final, así que una frase que oyó del altavoz puede llegar DESPUÉS
  // de que este termine, con `isSpeaking()` ya en falso. Cerrando el micrófono
  // durante el habla, esa frase ni se reconoce.
  let paused = false;

  // Guarda de eco. El reconocedor escucha MI micrófono, pero mi altavoz también
  // suena: mientras el otro oye la traducción de lo que dije, mi propio altavoz
  // está diciendo la traducción de lo que dijo él. Sin esta guarda, el micrófono
  // oye esa voz sintetizada, la reconoce como si fuera mía y la reenvía: el otro
  // la vuelve a traducir y a decir, y la llamada entra en un bucle que repite
  // frases cada vez más deformadas. Es el fallo que hace inservible una llamada
  // traducida sin auriculares, así que se corta aquí: lo que se reconozca
  // mientras habla el altavoz no se manda.
  function handleFinal(text) {
    if (destroyed || !active || paused) return;
    if (isSpeaking?.()) return;
    const clean = String(text).trim();
    if (!clean) return;
    const now = Date.now();
    if (clean === lastSent && now - lastAt < 5000) return;
    lastSent = clean;
    lastAt = now;

    onCaption?.({ original: clean, mine: true });
    send({ type: 'speech', text: clean });
  }

  // El reconocedor viene hecho de fuera, así que se le engancha aquí el manejador
  // que manda la frase. Sin este cable, se oiría pero no se enviaría nada.
  recognizer.setHandlers?.({ onFinal: handleFinal, onError });

  return {
    supported: true,
    start() {
      if (destroyed) return;
      active = true;
      paused = false;
      recognizer.start();
    },
    stop() {
      active = false;
      paused = false;
      recognizer.stop();
    },
    /**
     * Cierra el micrófono mientras habla el altavoz. Se llama al empezar la voz
     * sintetizada y se reanuda al terminar. Es semi-dúplex a propósito: en una
     * llamada traducida no se puede hablar y oír a la vez sin oírse a uno mismo.
     */
    pause() {
      if (destroyed || !active || paused) return;
      paused = true;
      recognizer.stop();
    },
    resume() {
      if (destroyed || !active || !paused) return;
      paused = false;
      recognizer.start();
    },
    destroy() {
      destroyed = true;
      active = false;
      recognizer.destroy();
    },
  };
}

/**
 * Recepción de la voz del otro en una llamada traducida.
 *
 * Recibe el texto que el otro reconoció de su propio micrófono, lo traduce a MI
 * idioma y lo dice por el altavoz. Los subtítulos enseñan las dos versiones: la
 * original (para poder comprobar qué dijo de verdad) y la traducida.
 *
 * Traduce aquí y no en el emisor porque el destino soy yo: mi idioma lo sé con
 * certeza, y el otro tendría que adivinarlo.
 */
export function createSpeechReceiver({
  targetLanguage,
  translate,
  speaker,
  onCaption,
  onError,
} = {}) {
  if (!speaker || typeof translate !== 'function') {
    return { supported: false, handle() {}, destroy() {} };
  }

  let destroyed = false;
  let target = targetLanguage;
  // El idioma del otro se aprende de la primera traducción y se reutiliza como
  // pista: en una llamada el origen no cambia a mitad.
  let source = null;

  // Cola de frases en curso, para que no se solapen dos traducciones de la misma
  // persona si habla rápido. Se traduce en serie, no en paralelo.
  let chain = Promise.resolve();

  function handle(text) {
    if (destroyed) return;
    const clean = String(text ?? '').trim();
    if (!clean) return;

    chain = chain
      .then(() =>
        Promise.resolve(translate({ text: clean, to: target, hint: source }))
      )
      .then((result) => {
        if (destroyed || !result) return;
        if (result.source) source = result.source;
        if (!result.translated || !result.text) {
          // No hacía falta traducir (o no se pudo): se enseña el original y no se
          // dice nada, para no repetir por el altavoz lo que ya se oyó.
          onCaption?.({ original: clean, translated: null, source: result.source });
          return;
        }
        onCaption?.({ original: clean, translated: result.text, source: result.source });
        speaker.say(result.text, target);
      })
      .catch((err) => {
        if (!destroyed) onError?.(err?.message || 'No se pudo traducir');
      });
  }

  return {
    supported: true,
    handle,
    setTargetLanguage(next) {
      target = normalizeLanguage(next) || next;
    },
    /** Corta lo que se está diciendo (por ejemplo, al colgar). */
    stop() {
      speaker.stop();
    },
    destroy() {
      destroyed = true;
      speaker.stop();
    },
  };
}
