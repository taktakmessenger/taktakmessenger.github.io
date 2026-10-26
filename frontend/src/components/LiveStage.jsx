import { useMemo } from 'react';
import { useVoiceRoom } from '../contexts/VoiceRoomContext';
import { useAuth } from '../contexts/AuthContext';
import { orderParticipants, guestColumns } from '../lib/liveGrid';

// Ventana de una persona en el directo. Es un `<video>` que engancha su stream
// cuando existe; si la cámara está apagada (o todavía no llegó), se pinta el
// avatar para que la ventana no quede en negro, igual que TikTok.
function LiveTile({ peer, stream, isHost, isSelf, local }) {
  const cameraOff = peer?.cameraOff;
  const label = isSelf ? 'Tú' : `@${peer?.username || '…'}`;
  const initial = (peer?.username?.[0] || '?').toUpperCase();

  return (
    <div className={`live-tile${isHost ? ' host' : ''}${isSelf ? ' self' : ''}`} data-peer={peer?.id || 'self'}>
      {!cameraOff && stream ? (
        <video
          className="live-video"
          autoPlay
          playsInline
          muted={local}
          // La ventana propia se refleja para verse como en un espejo, que es
          // como uno se espera ver en una cámara frontal.
          style={local ? { transform: 'scaleX(-1)' } : undefined}
          ref={(el) => {
            if (el && el.srcObject !== stream) el.srcObject = stream || null;
          }}
        />
      ) : (
        <span className="live-tile-avatar">{initial}</span>
      )}

      <span className="live-tile-name">
        {isHost && <span className="live-tile-host-badge">Anfitrión</span>}
        {label}
        {peer?.muted && <span className="live-tile-muted" aria-label="Silenciado">🔇</span>}
      </span>
    </div>
  );
}

/**
 * Directo de un TAK Creator a pantalla completa, al estilo de TikTok Live.
 *
 * La ventana del anfitrión (el dueño del creator) ocupa la parte de arriba y es
 * algo más grande que las demás; los invitados se reparten debajo en una rejilla
 * que se adapta a cuántos haya, hasta veinte. El audio de todos vive en los
 * elementos ocultos que monta `VoiceRoomBar`, así que aquí solo se pinta imagen.
 */
export default function LiveStage() {
  const {
    room,
    mode,
    peers,
    hostId,
    guestLimit,
    muted,
    camOff,
    stageOpen,
    streamTick,
    leave,
    toggleMute,
    toggleCamera,
    toggleStage,
    remoteStreamsRef,
    remoteVideoStreamsRef,
    localStreamRef,
  } = useVoiceRoom();
  const { user } = useAuth();

  // El anfitrión primero, los invitados después. `streamTick` entra en las
  // dependencias para que la rejilla se vuelva a calcular cuando llega un vídeo
  // nuevo (los streams viven en refs y no disparan render por sí solos).
  const { host, guests } = useMemo(() => {
    const me = { id: String(user?.id), username: user?.username, muted, cameraOff: camOff };
    const all = [me, ...peers];
    return orderParticipants(all, hostId);
  }, [peers, hostId, user, muted, camOff, streamTick]);

  if (!room || !stageOpen) return null;

  const columns = guestColumns(guests.length);
  const selfId = String(user?.id);

  // El stream de vídeo de cada persona. El propio sale del stream local; el de
  // los demás, del mapa de vídeo que llena el contexto.
  const videoStreamFor = (id) =>
    String(id) === selfId
      ? localStreamRef.current
      : remoteVideoStreamsRef.current.get(String(id));

  const hostIsSelf = host && String(host.id) === selfId;
  const hostStream = host ? videoStreamFor(host.id) : null;

  return (
    <div className="live-stage" role="dialog" aria-modal="true" aria-label={`Directo de ${room.name}`}>
      <header className="live-stage-head">
        <span className="live-badge">
          <span className="live-badge-dot" aria-hidden="true" />
          EN VIVO
        </span>
        <div className="live-stage-title">
          <strong>{room.name}</strong>
          <small>
            {guests.length} invitado{guests.length === 1 ? '' : 's'}
            {Number.isFinite(guestLimit) && guestLimit > 0 ? ` de ${guestLimit}` : ''}
            {mode && ` · ${mode === 'sfu' ? 'grupo' : 'directo'}`}
          </small>
        </div>
        <button
          type="button"
          className="live-stage-min"
          onClick={toggleStage}
          aria-label="Minimizar el directo"
        >
          ⌄
        </button>
      </header>

      <div className="live-stage-body">
        {/* Ventana del anfitrión: más grande, arriba. Si todavía no ha publicado
            su cámara, se ve su avatar con el rótulo de anfitrión. */}
        {host ? (
          <LiveTile
            peer={host}
            stream={hostStream}
            isHost
            isSelf={hostIsSelf}
            local={hostIsSelf}
          />
        ) : (
          <div className="live-tile host empty">
            <span className="live-tile-avatar">📡</span>
            <span className="live-tile-name">Esperando al anfitrión…</span>
          </div>
        )}

        {/* Rejilla de invitados. Las columnas se calculan con el número de
            invitados para que cada ventana sea lo más grande posible. */}
        {guests.length > 0 && (
          <div className="live-grid" style={{ '--live-cols': columns }}>
            {guests.map((p) => {
              const isSelf = String(p.id) === selfId;
              return (
                <LiveTile
                  key={p.id}
                  peer={p}
                  stream={videoStreamFor(p.id)}
                  isSelf={isSelf}
                  local={isSelf}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="live-stage-controls">
        <button
          type="button"
          className={`live-ctrl ${muted ? 'on' : ''}`}
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
        >
          {muted ? '🔇' : '🎤'}
        </button>
        <button
          type="button"
          className={`live-ctrl ${camOff ? 'on' : ''}`}
          onClick={toggleCamera}
          aria-pressed={camOff}
          aria-label={camOff ? 'Encender cámara' : 'Apagar cámara'}
        >
          {camOff ? '📷' : '🎥'}
        </button>
        <button type="button" className="live-ctrl end" onClick={leave} aria-label="Salir del directo">
          📵
        </button>
      </footer>
    </div>
  );
}
