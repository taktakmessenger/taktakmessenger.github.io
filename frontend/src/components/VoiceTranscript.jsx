// Transcripción y traducción de una nota de voz.
//
// Una nota de voz es audio ya grabado, no una llamada en vivo, así que no se
// puede reconocer con el micrófono: hay que pasarle el archivo al motor de
// reconocimiento. La forma de hacerlo sin subir el audio a ningún sitio es
// `SpeechRecognition` sobre un `MediaStream` hecho con `captureStream()` del
// propio `<audio>`... que no existe. El reconocedor del navegador solo escucha
// del micrófono.
//
// Por eso la nota de voz se transcribe reproduciéndola en alto y escuchándola:
// es feo, pero es lo único que se puede hacer sin mandar el audio a un servidor.
// Para que no sea molesto se hace solo cuando el usuario lo pide, y se avisa de
// que va a sonar.
//
// Cuando hay proveedor de STT en el servidor (`STT_PROVIDER`), la transcripción
// se pide al servidor, que sí puede recibir el archivo. Esta es la ruta buena, y
// la de arriba es el respaldo sin claves.

import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import TranslateIcon from './TranslateIcon';
import { translateText } from '../lib/translateClient';
import { canRecognize } from '../lib/speech';
import { speechLocale } from '../lib/translate';

export default function VoiceTranscript({ attachment, target, hint = null }) {
  const [text, setText] = useState('');
  const [translated, setTranslated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);

  const audioRef = useRef(null);
  const recognitionRef = useRef(null);

  // Se para el reconocimiento al desmontar: si no, el micrófono se queda
  // escuchando una nota de voz que ya no está en pantalla.
  useEffect(
    () => () => {
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // El objeto se descarta igual.
      }
    },
    []
  );

  // El servidor, si tiene proveedor de STT, puede transcribir el archivo de
  // verdad. Es el camino bueno: no hace sonar nada y funciona con auriculares.
  async function transcribeOnServer() {
    const { data } = await api.post('/messages/transcribe', { url: attachment.url });
    return data?.text || '';
  }

  // Respaldo sin proveedor: se reproduce la nota y se escucha por el micrófono.
  function transcribeLocally() {
    return new Promise((resolve, reject) => {
      const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      if (!canRecognize(Recognition)) {
        reject(new Error('Este navegador no puede transcribir notas de voz'));
        return;
      }

      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = speechLocale(hint) || speechLocale(target) || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;

      let finalText = '';

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const part = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) finalText += `${part} `;
        }
      };
      recognition.onerror = (event) => {
        if (event?.error && event.error !== 'no-speech' && event.error !== 'aborted') {
          reject(new Error('No se pudo transcribir la nota de voz'));
        }
      };
      recognition.onend = () => {
        setListening(false);
        resolve(finalText.trim());
      };

      const audio = audioRef.current;
      if (!audio) {
        reject(new Error('No se encontró el audio'));
        return;
      }

      audio.currentTime = 0;
      setListening(true);
      recognition.start();
      // Se reproduce en alto: es lo que permite que el micrófono lo oiga. Se para
      // al acabar el audio, que es cuando el reconocedor tiene todo lo dicho.
      audio
        .play()
        .then(() => {
          audio.onended = () => {
            setTimeout(() => {
              try {
                recognition.stop();
              } catch {
                resolve(finalText.trim());
              }
            }, 600);
          };
        })
        .catch(() => {
          try {
            recognition.abort();
          } catch {
            // Nada que hacer.
          }
          setListening(false);
          reject(new Error('No se pudo reproducir la nota de voz'));
        });
    });
  }

  async function run() {
    setBusy(true);
    setError('');
    try {
      let original = '';
      try {
        original = await transcribeOnServer();
      } catch {
        // Sin proveedor en el servidor se cae al reconocimiento local, que
        // necesita sonar. Se avisa en la interfaz con `listening`.
        original = await transcribeLocally();
      }

      if (!original) {
        setError('No se entendió la nota de voz');
        return;
      }
      setText(original);

      const result = await translateText({ text: original, to: target, hint });
      if (result.error) setError(result.error);
      else setTranslated(result);
    } catch (err) {
      setError(err?.message || 'No se pudo transcribir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="voice-transcript">
      <button
        type="button"
        className="voice-transcript-btn"
        onClick={run}
        disabled={busy}
        aria-label="Transcribir y traducir la nota de voz"
        title="Transcribir y traducir"
      >
        <TranslateIcon size={14} active={Boolean(text)} />
        <span>{busy ? (listening ? 'Escuchando…' : 'Transcribiendo…') : 'Texto'}</span>
      </button>

      {text && (
        <span className="voice-transcript-body">
          {/* El original se enseña siempre: la transcripción puede oír mal una
              palabra, y sin el original no hay forma de saber qué se dijo. */}
          <span className="voice-transcript-original">{text}</span>
          {translated?.translated && (
            <span className="voice-transcript-translated">{translated.text}</span>
          )}
        </span>
      )}

      {error && (
        <span className="voice-transcript-error" role="alert">
          {error}
        </span>
      )}

      {/* El mismo audio, reutilizado para el reconocimiento local. */}
      <audio ref={audioRef} src={attachment.url} preload="none" hidden />
    </span>
  );
}
