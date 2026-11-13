import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGroupCall } from '../contexts/GroupCallContext';

// Texto del estado, en lenguaje llano.
const LABELS = {
  outgoing: 'Llamando…',
  incoming: 'Llamada grupal entrante',
  active: 'En llamada',
};

// Una ventana de la rejilla. El vídeo del propio usuario se pinta desde el
// stream local; el de los demás, desde el stream remoto que dejó el contexto.
function GroupTile({ member, stream, local, selfId, muted, camOff }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== (stream || null)) el.srcObject = stream || null;
  }, [stream]);

  const isSelf = String(member.id) === String(selfId);
  const showVideo = stream && !(isSelf && camOff);
  const name = member.username ? `@${member.username}` : 'Alguien';

  return (
    <div className={`groupcall-tile${isSelf ? ' self' : ''}`}>
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={local} />
      ) : (
        <div className="groupcall-tile-avatar">
          <span className="avatar big">{(member.username || '?').slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      <span className="groupcall-tile-name">
        {isSelf ? 'Tú' : name}
        {isSelf && muted && <span aria-hidden="true"> 🔇</span>}
      </span>
    </div>
  );
}

// Audio remoto de cada participante. Va aparte del vídeo, en su propio
// elemento, para que la voz no dependa de qué se pinte en la rejilla.
function GroupAudio({ members, remoteStreamsRef, selfId }) {
  return (
    <div className="groupcall-audio">
      {members
        .filter((m) => String(m.id) !== String(selfId))
        .map((m) => (
          <audio
            key={m.id}
            autoPlay
            playsInline
            ref={(el) => {
              const stream = remoteStreamsRef.current.get(String(m.id));
              if (el && el.srcObject !== (stream || null)) el.srcObject = stream || null;
            }}
          />
        ))}
    </div>
  );
}

/**
 * Pantalla de la llamada grupal. Se pinta encima de todo lo demás, como la
 * llamada 1 a 1: si suena, tiene que verse.
 */
export default function GroupCallOverlay() {
  const { user } = useAuth();
  const {
    status,
    kind,
    selfId,
    incoming,
    members,
    muted,
    camOff,
    minimized,
    error,
    notice,
    streamTick,
    acceptGroupCall,
    rejectGroupCall,
    hangUp,
    toggleMute,
    toggleCamera,
    toggleMinimize,
    remoteStreamsRef,
    remoteVideoStreamsRef,
    localStreamRef,
  } = useGroupCall();

  // Un tick por cada stream nuevo: sin él, la rejilla no se vuelve a pintar
  // cuando llega el vídeo y la ventana se queda en el avatar.
  const streams = useMemo(
    () => ({ video: remoteVideoStreamsRef.current, audio: remoteStreamsRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamTick, remoteStreamsRef, remoteVideoStreamsRef]
  );

  if (status === 'idle') return null;

  const isIncoming = status === 'incoming';
  const self = { id: selfId, username: user?.username };
  // La rejilla la forman los que están dentro más uno mismo. Cuando aún no hay
  // lista (recién llamada), al menos sale uno para no quedar en blanco.
  const roster = members.length ? members : [self];
  const tiles = roster.some((m) => String(m.id) === String(selfId)) ? roster : [self, ...roster];

  const label = isIncoming
    ? incoming?.from?.username
      ? `@${incoming.from.username} te llama`
      : LABELS.incoming
    : LABELS[status] || '';

  return (
    <div className={`groupcall-overlay${minimized ? ' minimized' : ''}`}>
      {/* El audio remoto vive aquí, fuera del bloque que se oculta al
          minimizar: si se desmontara, la voz se cortaría justo al minimizar. */}
      <GroupAudio members={tiles} remoteStreamsRef={remoteStreamsRef} selfId={selfId} />

      <header className="groupcall-head">
        <strong>{kind === 'video' ? '📹 Llamada grupal' : '📞 Llamada grupal'}</strong>
        <span className="groupcall-state">{label}</span>
        <button
          type="button"
          className="groupcall-min"
          onClick={toggleMinimize}
          aria-label={minimized ? 'Maximizar llamada' : 'Minimizar llamada'}
        >
          {minimized ? '⤢' : '⌄'}
        </button>
      </header>

      {!minimized && (
        <>
          <div className={`groupcall-grid count-${Math.min(tiles.length, 4)}`}>
            {tiles.map((m) => {
              const isSelf = String(m.id) === String(selfId);
              const stream = isSelf
                ? localStreamRef.current
                : streams.video.get(String(m.id));
              return (
                <GroupTile
                  key={m.id}
                  member={m}
                  stream={stream}
                  local={isSelf}
                  selfId={selfId}
                  muted={muted}
                  camOff={camOff}
                />
              );
            })}
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && !error && <p className="call-info notice">{notice}</p>}

          <footer className="groupcall-controls">
            {isIncoming ? (
              <>
                <button
                  type="button"
                  className="call-btn end"
                  onClick={rejectGroupCall}
                  aria-label="Rechazar"
                >
                  📵
                </button>
                <button
                  type="button"
                  className="call-btn accept"
                  onClick={acceptGroupCall}
                  aria-label="Aceptar"
                >
                  📞
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`call-btn ${muted ? 'off' : ''}`}
                  onClick={toggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
                >
                  {muted ? '🔇' : '🎤'}
                </button>
                {kind === 'video' && (
                  <button
                    type="button"
                    className={`call-btn ${camOff ? 'off' : ''}`}
                    onClick={toggleCamera}
                    aria-pressed={camOff}
                    aria-label={camOff ? 'Encender cámara' : 'Apagar cámara'}
                  >
                    {camOff ? '📷' : '🎥'}
                  </button>
                )}
                <button
                  type="button"
                  className="call-btn end"
                  onClick={hangUp}
                  aria-label="Colgar"
                >
                  📵
                </button>
              </>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
