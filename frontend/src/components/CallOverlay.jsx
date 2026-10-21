import { useEffect, useRef, useState } from 'react';
import { useCall } from '../contexts/CallContext';
import { listAudioOutputs, applySink } from '../lib/sound';

// Texto del estado actual, en lenguaje llano.
const LABELS = {
  preparing: 'Preparando…',
  ringing: 'Llamando…',
  incoming: 'Llamada entrante',
  connecting: 'Conectando…',
  active: 'En llamada',
};

// Pantalla de llamada. Se pinta encima de todo lo demás porque una llamada es
// lo más urgente que puede pasar en la app: si suena, tiene que verse.
export default function CallOverlay() {
  const {
    status,
    kind,
    peer,
    error,
    notice,
    muted,
    camOff,
    minimized,
    remoteTick,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleMinimize,
    remoteStreamRef,
    localStreamRef,
  } = useCall();

  const remoteVideoRef = useRef(null);
  // En una llamada de voz no hay `<video>` remoto, así que el audio necesita su
  // propio elemento o la llamada conectaría en silencio: se oiría nada.
  const remoteAudioRef = useRef(null);
  const localVideoRef = useRef(null);

  // Salidas de audio del dispositivo (altavoz, auricular, Bluetooth). `setSinkId`
  // no existe en todos los navegadores; si no está, la lista queda vacía y el
  // selector no se muestra en vez de ofrecer algo que no funciona.
  const [outputs, setOutputs] = useState([]);
  const [speakerOn, setSpeakerOn] = useState(true);

  useEffect(() => {
    listAudioOutputs().then(setOutputs);
  }, []);

  // Manda el audio remoto a la salida elegida. Con el altavoz activado se usa la
  // salida por defecto del sistema; al desactivarlo se intenta el auricular.
  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;

    if (speakerOn) {
      applySink(audio, '');
      return;
    }

    // El dispositivo etiquetado como altavoz/manos libres es el que queremos
    // evitar; cualquier otra salida (auricular, altavoz del teléfono) sirve.
    const earpiece = outputs.find((o) => !/speaker|altavoz|manos libres/i.test(o.label));
    if (earpiece) applySink(audio, earpiece.id);
  }, [speakerOn, outputs, remoteTick, minimized]);

  // Engancha el stream remoto cuando llega. `remoteTick` cambia con cada stream
  // nuevo, así que el efecto se vuelve a ejecutar en la reconexión. `minimized`
  // entra en las dependencias porque al cambiar entre la pantalla completa y la
  // burbuja el elemento `<video>` es otro: sin esto, la burbuja quedaría negra.
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video && remoteStreamRef.current) {
      video.srcObject = remoteStreamRef.current;
      video.play().catch(() => {});
    }

    // El audio remoto se reproduce siempre, también en videollamada: el
    // elemento de vídeo lleva el stream completo, pero separarlo permite que la
    // voz siga oyéndose aunque el vídeo esté minimizado o la cámara apagada.
    const audio = remoteAudioRef.current;
    if (audio && remoteStreamRef.current) {
      audio.srcObject = remoteStreamRef.current;
      audio.play().catch(() => {});
    }
  }, [remoteTick, status, minimized, remoteStreamRef]);

  // La vista propia se muestra en pequeño, como en cualquier app de llamadas.
  useEffect(() => {
    const video = localVideoRef.current;
    if (video && localStreamRef.current) {
      video.srcObject = localStreamRef.current;
      video.play().catch(() => {});
    }
  }, [status, kind, minimized, localStreamRef]);

  if (status === 'idle') {
    // El error de una llamada ya terminada sigue siendo útil unos segundos,
    // pero sin una llamada en curso no hay nada que superponer.
    return error ? (
      <div className="call-toast" role="status">
        {error}
      </div>
    ) : null;
  }

  const isIncoming = status === 'incoming';
  const isActive = status === 'active';

  // Burbuja flotante: la llamada sigue viva y con audio, pero se aparta a una
  // esquina para poder seguir viendo el feed. Se toca para volver a la pantalla
  // completa. Solo se ofrece con la llamada en curso: una entrante debe verse
  // entera para poder aceptarla.
  if (minimized && isActive) {
    return (
      <button
        type="button"
        className="call-bubble-pip"
        onClick={toggleMinimize}
        aria-label="Volver a la llamada"
      >
        {kind === 'video' ? (
          <video ref={remoteVideoRef} className="call-bubble-video" autoPlay playsInline />
        ) : (
          <span className="call-bubble-avatar">
            {peer?.username?.slice(0, 2).toUpperCase() || '??'}
          </span>
        )}
        <span className="call-bubble-meta">
          <strong>@{peer?.username || '…'}</strong>
          <small>{LABELS[status] || status}</small>
        </span>
      </button>
    );
  }

  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-stage">
        {/* El audio remoto oyente siempre, en voz y en vídeo. Va fuera del
            bloque condicional para que exista desde el primer render de la
            llamada; si se montara y desmontara, el enganche del stream se
            perdería. */}
        <audio ref={remoteAudioRef} autoPlay playsInline />

        {kind === 'video' && isActive ? (
          <video ref={remoteVideoRef} className="call-remote" autoPlay playsInline />
        ) : (
          <div className="call-avatar">
            <span>{peer?.username?.slice(0, 2).toUpperCase() || '??'}</span>
          </div>
        )}

        {kind === 'video' && !camOff && (
          <video ref={localVideoRef} className="call-local" autoPlay playsInline muted />
        )}

        <div className="call-info">
          <strong>@{peer?.username || '…'}</strong>
          <span>{LABELS[status] || status}</span>
          {error && <small className="error">{error}</small>}
          {!error && notice && <small className="notice">{notice}</small>}
        </div>
      </div>

      <div className="call-actions">
        {isIncoming ? (
          <>
            <button type="button" className="call-btn accept" onClick={acceptCall}>
              ✅ Aceptar
            </button>
            <button type="button" className="call-btn end" onClick={rejectCall}>
              ❌ Rechazar
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`call-btn ${muted ? 'off' : ''}`}
              onClick={toggleMute}
              aria-pressed={muted}
            >
              {muted ? '🔇' : '🎤'}
            </button>

            {kind === 'video' && (
              <button
                type="button"
                className={`call-btn ${camOff ? 'off' : ''}`}
                onClick={toggleCamera}
                aria-pressed={camOff}
              >
                {camOff ? '📷' : '🎥'}
              </button>
            )}

            {/* Altavoz del teléfono. Solo aparece si el navegador soporta elegir
                la salida (setSinkId); si no, no hay nada que ofrecer. */}
            {outputs.length > 0 && (
              <button
                type="button"
                className={`call-btn ${speakerOn ? '' : 'off'}`}
                onClick={() => setSpeakerOn((on) => !on)}
                aria-pressed={speakerOn}
                aria-label={speakerOn ? 'Desactivar altavoz' : 'Activar altavoz'}
              >
                {speakerOn ? '🔊' : '📞'}
              </button>
            )}

            {/* Minimizar solo con la llamada en curso: durante el timbrado el
                usuario necesita ver a quién llama y poder colgar. */}
            {isActive && (
              <button
                type="button"
                className="call-btn"
                onClick={toggleMinimize}
                aria-label="Minimizar llamada"
              >
                🔽
              </button>
            )}

            <button type="button" className="call-btn end" onClick={hangUp}>
              📵 Colgar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
