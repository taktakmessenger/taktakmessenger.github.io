import { useVoiceRoom } from '../contexts/VoiceRoomContext';
import { useAuth } from '../contexts/AuthContext';

/**
 * Panel flotante del directo, al estilo de la burbuja de llamada. Se muestra
 * siempre que estés dentro de un directo y lo tengas minimizado, sin importar
 * la pestaña, para poder seguir navegando mientras hablas (y para no perder el
 * audio). El sonido vive en `VoiceRoomAudio`, que está montado siempre: aquí
 * solo van los controles.
 */
export default function VoiceRoomBar() {
  const {
    room,
    mode,
    peers,
    hostId,
    muted,
    camOff,
    stageOpen,
    leave,
    toggleMute,
    toggleCamera,
    toggleStage,
  } = useVoiceRoom();
  const { user } = useAuth();

  // Con la vista a pantalla completa abierta, la barra no se pinta: el directo
  // ya tiene sus propios controles y dos juegos a la vez confundirían.
  if (!room || stageOpen) return null;

  const others = peers.filter((p) => String(p.id) !== String(user?.id));
  const speaking = others.length + 1;
  const hostLabel = hostId && String(hostId) === String(user?.id) ? ' · eres anfitrión' : '';

  return (
    <div className="voice-bar" role="region" aria-label="Directo del creator">
      <div className="voice-bar-main">
        <span className="voice-bar-dot" aria-hidden="true" />
        <div className="voice-bar-text">
          <strong>📡 {room.name}</strong>
          <small>
            {speaking === 1 ? 'Estás solo en el directo' : `${speaking} en el directo`}
            {hostLabel}
            {mode && (
              <span className="voice-mode" title={mode === 'sfu' ? 'Audio y vídeo reenviados por el servidor' : 'Conexión directa entre participantes'}>
                {' '}· {mode === 'sfu' ? 'grupo' : 'directo'}
              </span>
            )}
          </small>
        </div>
        <div className="voice-bar-peers" aria-hidden="true">
          {others.map((p) => (
            <span key={p.id} className={`voice-avatar ${p.muted ? 'muted' : ''}`} title={`@${p.username}`}>
              {p.username?.[0]?.toUpperCase() || '?'}
            </span>
          ))}
        </div>
      </div>

      <div className="voice-bar-actions">
        <button
          type="button"
          className="voice-btn"
          onClick={toggleStage}
          aria-label="Ver el directo a pantalla completa"
        >
          ⤢
        </button>
        <button
          type="button"
          className={`voice-btn ${camOff ? 'on' : ''}`}
          onClick={toggleCamera}
          aria-pressed={camOff}
          aria-label={camOff ? 'Encender cámara' : 'Apagar cámara'}
        >
          {camOff ? '📷' : '🎥'}
        </button>
        <button
          type="button"
          className={`voice-btn ${muted ? 'on' : ''}`}
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
        >
          {muted ? '🔇' : '🎤'}
        </button>
        <button type="button" className="voice-btn end" onClick={leave} aria-label="Salir del directo">
          📵
        </button>
      </div>
    </div>
  );
}
