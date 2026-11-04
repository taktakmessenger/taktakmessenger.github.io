import { useEffect, useMemo, useState } from 'react';
import { useVoiceRoom } from '../contexts/VoiceRoomContext';
import { useAuth } from '../contexts/AuthContext';
import { orderParticipants, guestColumns, stageColumns } from '../lib/liveGrid';
import LiveChat from './LiveChat';
import LiveGifts from './LiveGifts';
import PokerTable from './PokerTable';

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
 * La idea de la ventana es la de TikTok: arriba, el anfitrión (el dueño del
 * creator) en una ficha con su avatar, su nombre y cuánta gente mira; debajo, la
 * rejilla de invitados, que se adapta a cuántos haya (hasta quince invitados
 * además del anfitrión). Con el botón de diseños se pasa a "Rejilla", donde
 * todos comparten el mismo tamaño, que es la otra vista de TikTok para
 * multi-invitado. Los espectadores no ocupan ventana: solo miran y comentan, y
 * su número se enseña junto al ojo, como en TikTok.
 *
 * El audio de todos vive en los elementos ocultos que monta `VoiceRoomBar`, así
 * que aquí solo se pinta imagen.
 */
export default function LiveStage() {
  const {
    room,
    mode,
    peers,
    hostId,
    guestLimit,
    viewerCount,
    muted,
    camOff,
    stageOpen,
    streamTick,
    leave,
    toggleMute,
    toggleCamera,
    toggleStage,
    spectate,
    remoteStreamsRef,
    remoteVideoStreamsRef,
    localStreamRef,
  } = useVoiceRoom();
  const { user } = useAuth();

  // Panel de comentarios abierto por defecto (es lo que se espera de un directo)
  // y regalos a un toque desde el botón 🎁.
  const [chatOpen, setChatOpen] = useState(true);
  const [giftsOpen, setGiftsOpen] = useState(false);
  // El último regalo recibido, para la animación breve encima del vídeo.
  const [flash, setFlash] = useState(null);
  // Ventana activa del directo: el propio directo ("live") o la mesa de póker
  // ("games"). Los dos botones de arriba al centro conmutan entre ellas.
  const [view, setView] = useState('live');
  // Diseño de la ventana, como en TikTok: "panel" deja al anfitrión grande
  // arriba; "rejilla" pone a todos en cuadrícula del mismo tamaño. Se recuerda
  // entre directos para no tener que elegirlo cada vez.
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem('taktak_live_layout') === 'grid' ? 'grid' : 'panel';
    } catch {
      return 'panel';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('taktak_live_layout', layout);
    } catch {
      // Sin almacenamiento (modo privado): el diseño vale para esta sesión.
    }
  }, [layout]);

  // La ventana propia solo se pinta si publicamos algo. Un espectador no tiene
  // ventana: solo ve a los demás y comenta.
  const selfParticipates = !spectate;

  // El anfitrión primero, los invitados después. `streamTick` entra en las
  // dependencias para que la rejilla se vuelva a calcular cuando llega un vídeo
  // nuevo (los streams viven en refs y no disparan render por sí solos).
  const { host, guests } = useMemo(() => {
    const me = { id: String(user?.id), username: user?.username, muted, cameraOff: camOff };
    // Un espectador no ocupa ventana: solo ve a los que publican.
    const all = selfParticipates ? [me, ...peers] : [...peers];
    return orderParticipants(all, hostId);
  }, [peers, hostId, user, muted, camOff, streamTick, selfParticipates]);

  if (!room || !stageOpen) return null;

  const selfId = String(user?.id);

  // El stream de vídeo de cada persona. El propio sale del stream local; el de
  // los demás, del mapa de vídeo que llena el contexto.
  const videoStreamFor = (id) =>
    String(id) === selfId
      ? localStreamRef.current
      : remoteVideoStreamsRef.current.get(String(id));

  const hostIsSelf = host && String(host.id) === selfId;
  const hostStream = host ? videoStreamFor(host.id) : null;

  // La sala de juegos es la mesa de POKERTAK. Se monta encima del directo; al
  // cerrarla se vuelve a "Live".
  if (view === 'games') {
    return <PokerTable slug={room.slug} onClose={() => setView('live')} />;
  }

  const guestTotal = guests.length;
  const layoutIsGrid = layout === 'grid';
  const columns = layoutIsGrid ? stageColumns((host ? 1 : 0) + guestTotal) : guestColumns(guestTotal);

  // En el diseño de rejilla el anfitrión es una ventana más: se juntan host e
  // invitados en la misma cuadrícula, con el anfitrión primero.
  const gridTiles = layoutIsGrid ? (host ? [host, ...guests] : guests) : guests;

  return (
    <div
      className="live-stage"
      role="dialog"
      aria-modal="true"
      data-mode={mode || ''}
      data-layout={layout}
      aria-label={`Directo de ${room.name}`}
    >
      <header className="live-stage-head">
        {/* Ficha del anfitrión, como la cabecera de TikTok: avatar con anillo de
            EN VIVO, su nombre y, debajo, cuánta gente mira. */}
        <div className="live-host-chip">
          <span className="live-host-avatar" aria-hidden="true">
            {(host?.username?.[0] || room.name?.[0] || '?').toUpperCase()}
          </span>
          <div className="live-host-text">
            <strong>@{host?.username || room.name}</strong>
            <small>
              <span className="live-badge">
                <span className="live-badge-dot" aria-hidden="true" />
                EN VIVO
              </span>
              <span className="live-viewers" title="Espectadores">
                👁 {viewerCount}
              </span>
              {spectate && <span className="live-role">Espectador</span>}
              <span className="voice-mode">
                {mode === 'sfu' ? 'grupo' : 'directo'}
              </span>
            </small>
          </div>
        </div>

        <div className="live-stage-tools">
          {/* Diseños: Panel (anfitrión grande) y Rejilla (todos iguales), los dos
              de TikTok. El botón alterna y el icono enseña el actual. */}
          <button
            type="button"
            className={`live-stage-min ${layoutIsGrid ? 'active' : ''}`}
            onClick={() => setLayout((l) => (l === 'grid' ? 'panel' : 'grid'))}
            aria-label={layoutIsGrid ? 'Cambiar a diseño de panel' : 'Cambiar a diseño de rejilla'}
            title={layoutIsGrid ? 'Diseño: rejilla' : 'Diseño: panel'}
          >
            {layoutIsGrid ? '▦' : '▤'}
          </button>
          <button
            type="button"
            className={`live-stage-min ${chatOpen ? 'active' : ''}`}
            onClick={() => setChatOpen((open) => !open)}
            aria-pressed={chatOpen}
            aria-label={chatOpen ? 'Ocultar comentarios' : 'Mostrar comentarios'}
          >
            💬
          </button>
          <button
            type="button"
            className="live-stage-min"
            onClick={toggleStage}
            aria-label="Minimizar el directo"
          >
            ⌄
          </button>
        </div>
      </header>

      <div className="live-stage-view">
        <div className={`live-stage-body${layoutIsGrid ? ' grid-layout' : ''}`}>
          {/* Diseño de panel: el anfitrión en su ventana grande arriba. */}
          {!layoutIsGrid &&
            (host ? (
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
            ))}

          {/* Rejilla: en panel son los invitados bajo el anfitrión; en rejilla son
              todos (anfitrión incluido) en cuadrícula del mismo tamaño. Las
              columnas se calculan para que cada ventana sea lo más grande
              posible. */}
          {gridTiles.length > 0 && (
            <div className={`live-grid${layoutIsGrid ? ' all-equal' : ''}`} style={{ '--live-cols': columns }}>
              {gridTiles.map((p) => {
                const isSelf = String(p.id) === selfId;
                return (
                  <LiveTile
                    key={p.id}
                    peer={p}
                    stream={videoStreamFor(p.id)}
                    isHost={host ? String(p.id) === String(host.id) : false}
                    isSelf={isSelf}
                    local={isSelf}
                  />
                );
              })}
            </div>
          )}

          {!layoutIsGrid && guestTotal === 0 && !spectate && (
            <p className="live-stage-hint">
              Comparte el enlace del creator para que entren invitados: caben hasta{' '}
              {Number.isFinite(guestLimit) && guestLimit > 0 ? guestLimit : 15} contigo.
            </p>
          )}
        </div>

        {/* Animación breve del último regalo, encima del vídeo. Se borra sola
            para no tapar el directo (como en TikTok). */}
        {flash && (
          <div
            className="live-gift-flash"
            key={flash.at}
            onAnimationEnd={() => setFlash(null)}
          >
            <span className="live-gift-flash-icon" aria-hidden="true">🎁</span>
            <span>
              <strong>@{flash.from}</strong> envió {flash.giftName}
            </span>
          </div>
        )}

        {/* Comentarios del directo, encima del vídeo. Es el canal de la sala de
            voz, así que el servidor ya comprobó al unirse quién puede escribir.
            Con los regalos abiertos solo se oculta (no se desmonta): al
            desmontarlo se saldría de la sala y el regalo que se acaba de enviar
            se perdería antes de salir. */}
        {chatOpen && <LiveChat room={room.room} onGift={setFlash} hidden={giftsOpen} />}

        {/* Botones de regalo. El cobro va por el monedero y la animación por el
            socket; el receptor es el anfitrión del directo. */}
        {giftsOpen && <LiveGifts room={room.room} recipientId={hostId} />}
      </div>

      <footer className="live-stage-controls">
        {!spectate && (
          <button
            type="button"
            className={`live-ctrl ${muted ? 'on' : ''}`}
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            {muted ? '🔇' : '🎤'}
          </button>
        )}
        {/* La sala de juegos vive aquí, junto al micrófono. El icono son dos
            ases cruzados en forma de V. */}
        <button
          type="button"
          className={`live-ctrl games ${view === 'games' ? 'active' : ''}`}
          onClick={() => setView((v) => (v === 'games' ? 'live' : 'games'))}
          aria-pressed={view === 'games'}
          aria-label="Sala de juegos"
          title="Sala de juegos"
        >
          <svg className="live-ctrl-aces" viewBox="0 0 32 24" aria-hidden="true" focusable="false">
            <text x="11" y="19" textAnchor="middle" className="ace-card" transform="rotate(-20 11 20)">A</text>
            <text x="21" y="19" textAnchor="middle" className="ace-card" transform="rotate(20 21 20)">A</text>
          </svg>
        </button>
        {!spectate && (
          <button
            type="button"
            className={`live-ctrl ${camOff ? 'on' : ''}`}
            onClick={toggleCamera}
            aria-pressed={camOff}
            aria-label={camOff ? 'Encender cámara' : 'Apagar cámara'}
          >
            {camOff ? '📷' : '🎥'}
          </button>
        )}
        <button
          type="button"
          className={`live-ctrl ${giftsOpen ? 'on' : ''}`}
          onClick={() => setGiftsOpen((open) => !open)}
          aria-pressed={giftsOpen}
          aria-label="Enviar un regalo"
        >
          🎁
        </button>
        <button type="button" className="live-ctrl end" onClick={leave} aria-label="Salir del directo">
          📵
        </button>
      </footer>
    </div>
  );
}
