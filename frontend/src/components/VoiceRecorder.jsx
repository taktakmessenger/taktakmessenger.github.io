import { useEffect, useRef, useState } from 'react';
import {
  canRecordAudio,
  pickAudioMimeType,
  voiceNoteFileName,
  secondsFromMs,
  formatDuration,
} from '../lib/voiceNote';

// Grabadora de notas de voz, al estilo WhatsApp: se mantiene pulsado para
// grabar, se suelta para enviar y se desliza fuera para cancelar.
//
// Se hace con pulsación mantenida (pointerdown/pointerup) y no con un botón de
// encendido/apagado porque es lo que espera cualquiera que haya usado WhatsApp,
// y porque el gesto de "soltar" da un final natural a la grabación.
//
// El componente no habla con la API: entrega el archivo grabado y quien lo usa
// decide qué hacer con él (subirlo y enviarlo). Así la grabación se puede probar
// sin red y el envío reutiliza el mismo camino que un mensaje normal.
const MAX_SECONDS = 300; // 5 minutos: más que eso no es una nota de voz.

export default function VoiceRecorder({ onRecorded, disabled }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  // Se marca al cancelar para que el `onstop` sepa que debe tirar lo grabado en
  // vez de entregarlo. Sin esta bandera, cancelar enviaría el audio igual.
  const cancelledRef = useRef(false);

  const supported = canRecordAudio();

  // Suelta el micrófono y para el reloj. Se llama al terminar, al cancelar y al
  // desmontar: dejar una pista abierta mantiene encendido el indicador de
  // grabación del navegador y del sistema.
  function releaseStream() {
    clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Si el usuario cambia de pantalla a mitad de grabación, no puede quedar el
  // micro abierto ni un `setState` sobre un componente desmontado.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try {
        recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      } catch {
        // Parar dos veces lanza; aquí no importa.
      }
      releaseStream();
    };
  }, []);

  async function start(event) {
    if (disabled || recording) return;
    // Se captura el puntero para recibir el `pointerup` aunque el dedo se salga
    // del botón: sin esto, soltar fuera dejaba la grabación encendida.
    event.currentTarget.setPointerCapture?.(event.pointerId);

    setError('');
    cancelledRef.current = false;
    chunksRef.current = [];

    if (!supported) {
      setError('Tu navegador no puede grabar audio');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // El caso normal es un permiso denegado, y el mensaje tiene que decir qué
      // hacer, no "error".
      setError('Permiso de micrófono denegado');
      return;
    }

    streamRef.current = stream;
    const mimeType = pickAudioMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const chunks = chunksRef.current;
      const type = recorder.mimeType || mimeType || 'audio/webm';
      releaseStream();
      setRecording(false);
      setSeconds(0);

      if (cancelledRef.current || chunks.length === 0) return;

      const blob = new Blob(chunks, { type });
      // El nombre lleva la extensión correcta para el tipo: el servidor
      // clasifica por extensión y con `.webm` tomaría el audio por un vídeo.
      const file = new File([blob], voiceNoteFileName(type), { type });
      onRecorded?.(file, secondsFromMs(durationMs));
    };

    startedAtRef.current = Date.now();
    recorder.start();
    setRecording(true);
    setSeconds(0);

    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      // Al llegar al tope se corta solo y se envía lo grabado: dejar crecer el
      // archivo sin límite acabaría chocando con el máximo del servidor.
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    try {
      recorder.stop();
    } catch {
      releaseStream();
      setRecording(false);
    }
  }

  function cancel() {
    cancelledRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop();
      } catch {
        releaseStream();
        setRecording(false);
      }
    } else {
      releaseStream();
      setRecording(false);
    }
  }

  if (recording) {
    return (
      <div className="voice-recording" role="status" aria-live="polite">
        <button
          type="button"
          className="voice-cancel"
          onClick={cancel}
          aria-label="Cancelar grabación"
        >
          🗑
        </button>
        <span className="voice-dot" aria-hidden="true" />
        <span className="voice-time">{formatDuration(seconds)}</span>
        <button
          type="button"
          className="voice-send"
          onClick={stop}
          aria-label="Enviar nota de voz"
        >
          Enviar
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="composer-mic"
        onPointerDown={start}
        onPointerUp={stop}
        disabled={disabled}
        aria-label="Mantén pulsado para grabar una nota de voz"
        title="Mantén pulsado para grabar"
      >
        🎤
      </button>
      {error && (
        <p className="error voice-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
