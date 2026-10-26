import { useVoiceRoom } from '../contexts/VoiceRoomContext';
import { useAuth } from '../contexts/AuthContext';

// Audio remoto de un participante. Va fuera de la vista del directo (en su
// propio componente siempre montado) porque si el elemento se desmontara al
// abrir la rejilla a pantalla completa, la pista remota dejaría de sonar: es el
// mismo fallo que tenía la llamada minimizada. Un `<audio>` por par mantiene el
// audio vivo mientras estés dentro.
function PeerAudio({ peerId, stream }) {
  const ref = (el) => {
    if (el && el.srcObject !== stream) el.srcObject = stream || null;
  };
  return <audio ref={ref} autoPlay playsInline data-peer={peerId} />;
}

/**
 * Sumidero de audio del directo. Es un componente aparte, montado siempre que
 * estés en una sala, porque el audio NO puede depender de qué se esté pintando:
 * ni la barra flotante ni la rejilla a pantalla completa son dueñas del sonido,
 * solo lo acompañan. El vídeo se pinta en las ventanas; aquí solo va la voz.
 */
export default function VoiceRoomAudio() {
  const { room, peers, streamTick, remoteStreamsRef } = useVoiceRoom();
  const { user } = useAuth();

  if (!room) return null;

  const others = peers.filter((p) => String(p.id) !== String(user?.id));

  return (
    <div className="voice-audio" data-tick={streamTick}>
      {others.map((p) => (
        <PeerAudio key={p.id} peerId={p.id} stream={remoteStreamsRef.current.get(p.id)} />
      ))}
    </div>
  );
}
