import { useVoiceRoom } from '../contexts/VoiceRoomContext';
import { useAuth } from '../contexts/AuthContext';

// Audio remoto de un participante. Va fuera de la vista de Squads (en la barra
// persistente) porque si el elemento se desmontara al cambiar de pestaña, la
// pista remota dejaría de sonar: es el mismo fallo que tenía la llamada
// minimizada. Un `<audio>` por par mantiene el audio vivo mientras estés dentro.
function PeerAudio({ peerId, stream }) {
  const ref = (el) => {
    if (el && el.srcObject !== stream) el.srcObject = stream || null;
  };
  return <audio ref={ref} autoPlay playsInline data-peer={peerId} />;
}

/**
 * Panel flotante de la sala de voz, al estilo de la burbuja de llamada. Se
 * muestra siempre que estés dentro de una sala, sin importar la pestaña, para
 * poder seguir navegando mientras hablas (y para no perder el audio).
 */
export default function VoiceRoomBar() {
  const { room, peers, muted, streamTick, leave, toggleMute, remoteStreamsRef } = useVoiceRoom();
  const { user } = useAuth();

  if (!room) return null;

  const others = peers.filter((p) => String(p.id) !== String(user?.id));
  const speaking = others.length + 1;

  return (
    <div className="voice-bar" role="region" aria-label="Sala de voz del creator">
      <div className="voice-bar-main">
        <span className="voice-bar-dot" aria-hidden="true" />
        <div className="voice-bar-text">
          <strong>🎙 {room.name}</strong>
          <small>{speaking === 1 ? 'Estás solo en la sala' : `${speaking} en la sala`}</small>
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
          className={`voice-btn ${muted ? 'on' : ''}`}
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
        >
          {muted ? '🔇' : '🎤'}
        </button>
        <button type="button" className="voice-btn end" onClick={leave} aria-label="Salir de la sala">
          📵
        </button>
      </div>

      {/* Elementos de audio ocultos: uno por participante. `streamTick` obliga a
          volver a engancharlos cuando entra un stream nuevo. */}
      <div className="voice-audio" data-tick={streamTick}>
        {others.map((p) => (
          <PeerAudio key={p.id} peerId={p.id} stream={remoteStreamsRef.current.get(p.id)} />
        ))}
      </div>
    </div>
  );
}
