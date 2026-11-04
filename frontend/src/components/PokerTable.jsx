import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { useVoiceRoom } from '../contexts/VoiceRoomContext';
import {
  seatLayout,
  formatCoins,
  legalActions,
  ownSeat,
  phaseLabel,
  actionLabel,
} from '../lib/pokerUi';
import PokerTakLogo from './PokerTakLogo';
import LiveChat from './LiveChat';

// Carta de la baraja: "As" -> A♠. Se pintan rojas las de corazones y diamantes.
const SUIT_ICON = { s: '♠', h: '♥', d: '♦', c: '♣' };
function PlayingCard({ label, hidden }) {
  if (hidden || !label) {
    return <span className="ptak-card back" aria-hidden="true" />;
  }
  const rank = label.slice(0, -1);
  const suit = label.slice(-1);
  const red = suit === 'h' || suit === 'd';
  return (
    <span className={`ptak-card${red ? ' red' : ''}`}>
      <span className="ptak-card-rank">{rank}</span>
      <span className="ptak-card-suit">{SUIT_ICON[suit]}</span>
    </span>
  );
}

// Un asiento de la mesa. Enseña la cara del jugador (póker face), su nombre, la
// pila y las cartas; se resalta cuando es el turno y cuando acaba de ganar.
//
// La cara va en un óvalo con el vídeo de la sala de voz del directo: los
// jugadores se ven y se hablan mientras juegan, sin abrir otra conexión. Si la
// cámara está apagada o el vídeo aún no llegó, el óvalo enseña el avatar para
// que el asiento nunca quede en negro.
function Seat({ player, position, isTurn, isSelf, isWinner, layout, face }) {
  if (!player || player.empty) return null;
  const hole = player.holeCards || [];
  const initial = (player.username?.[0] || '?').toUpperCase();
  const showVideo = face?.stream && !face?.cameraOff;
  return (
    <div
      className={[
        'ptak-seat',
        isSelf ? 'self' : '',
        isTurn ? 'turn' : '',
        player.folded ? 'folded' : '',
        player.allIn ? 'allin' : '',
        isWinner ? 'winner' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      data-seat={player.seat}
    >
      {/* Póker face: la cara del jugador en un círculo ovalado. */}
      <div className={`ptak-face${showVideo ? '' : ' off'}`} aria-hidden="true">
        {showVideo ? (
          <video
            className="ptak-face-video"
            autoPlay
            playsInline
            muted={isSelf}
            style={isSelf ? { transform: 'scaleX(-1)' } : undefined}
            ref={(el) => {
              if (el && el.srcObject !== face.stream) el.srcObject = face.stream || null;
            }}
          />
        ) : (
          <span className="ptak-face-initial">{initial}</span>
        )}
        {face?.muted && <span className="ptak-face-muted" aria-label="Micrófono apagado">🔇</span>}
      </div>
      <div className="ptak-seat-cards">
        {hole.length > 0
          ? hole.map((c, i) => <PlayingCard key={i} label={c} hidden={!c} />)
          : <span className="ptak-card empty" aria-hidden="true" />}
      </div>
      <div className="ptak-seat-info">
        <strong>{isSelf ? 'Tú' : `@${player.username}`}</strong>
        <span className="ptak-seat-stack">🪙 {formatCoins(player.stack)}</span>
        {player.bet > 0 && <span className="ptak-seat-bet">Apostado {formatCoins(player.bet)}</span>}
        {player.handLabel && <span className="ptak-seat-hand">{player.handLabel}</span>}
      </div>
      {isWinner && <span className="ptak-seat-crown" aria-label="Ganador">👑</span>}
      {layout != null && <span className="ptak-seat-index">{layout}</span>}
    </div>
  );
}

/**
 * Mesa de POKERTAK, la sala de póker privada que se abre desde el directo.
 *
 * El estado entero viene del servidor por `poker:state`; aquí no se calcula nada
 * de juego, solo se pinta y se mandan acciones. El centro de la mesa lleva el
 * nombre POKERTAK, el eslogan y el logo del queso con la semilla de mango.
 */
export default function PokerTable({ slug, onClose }) {
  const { emit, socket } = useSocket();
  const { user } = useAuth();
  // La sala de voz del directo ya está abierta: los jugadores ven y oyen por
  // ella. La mesa reutiliza esos mismos streams para las caras, sin abrir otra
  // conexión de vídeo ni pedir permisos de nuevo.
  const {
    room: voiceRoomInfo,
    peers,
    localStreamRef,
    remoteVideoStreamsRef,
    camOff,
    streamTick,
  } = useVoiceRoom();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [closed, setClosed] = useState(false);
  // Comentarios de la mesa: el mismo hilo del directo, así Asistak vigila
  // también lo que se dice jugando y el aviso sale en la parte de comentarios.
  const [chatOpen, setChatOpen] = useState(false);

  // Al abrir la mesa se pide el estado. Al cerrar, se avisa al servidor para que
  // devuelva las fichas al monedero.
  useEffect(() => {
    if (!socket) return undefined;
    const onState = (s) => { setState(s); setError(''); };
    const onError = ({ error: msg } = {}) => setError(msg || 'Error');
    const onClosed = () => setClosed(true);
    socket.on('poker:state', onState);
    socket.on('poker:error', onError);
    socket.on('poker:closed', onClosed);
    emit('poker:open', { slug });
    return () => {
      socket.off('poker:state', onState);
      socket.off('poker:error', onError);
      socket.off('poker:closed', onClosed);
      // Al desmontar (cerrar la ventana) se sale de la mesa para que las fichas
      // vuelvan al monedero y no queden dentro de una mesa en memoria.
      emit('poker:leave', {});
    };
  }, [socket, slug, emit]);

  const mySeat = ownSeat(state, user?.id);
  const actions = useMemo(() => legalActions(state, mySeat), [state, mySeat]);

  // El importe de subida arranca en el mínimo legal y se recoloca cuando cambia
  // el turno, para no dejar un valor de la mano anterior.
  useEffect(() => {
    if (actions.yourTurn) setRaiseTo(actions.minRaiseTo);
  }, [actions.yourTurn, actions.minRaiseTo]);

  const positions = useMemo(
    () => seatLayout(state?.maxSeats || 6),
    [state?.maxSeats],
  );
  const winnerIds = new Set((state?.winners || []).map((w) => String(w.userId)));
  const seated = (state?.seats || []).filter((s) => s && !s.empty);

  const selfId = String(user?.id ?? user?._id ?? '');

  // La cara de cada jugador, por id de usuario. El propio sale del stream local;
  // el de los demás, del mapa de vídeo de la sala de voz. `streamTick` entra en
  // las dependencias porque los streams viven en refs y no disparan render solos.
  const faceFor = useMemo(() => {
    const map = new Map();
    map.set(selfId, {
      stream: localStreamRef.current,
      cameraOff: camOff,
      muted: false,
    });
    for (const p of peers) {
      const id = String(p.id);
      map.set(id, {
        stream: remoteVideoStreamsRef.current.get(id) || null,
        cameraOff: p.cameraOff,
        muted: p.muted,
      });
    }
    return map;
  }, [selfId, peers, camOff, streamTick, localStreamRef, remoteVideoStreamsRef]);

  function send(action, amount) {
    setBusy(true);
    setError('');
    emit('poker:act', { action, amount });
    // El estado que llegue desbloquea; no se espera respuesta del emit.
    setTimeout(() => setBusy(false), 400);
  }

  if (closed) {
    return (
      <div className="ptak-overlay" role="dialog" aria-modal="true" aria-label="Mesa de POKERTAK cerrada">
        <div className="ptak-closed">
          <PokerTakLogo size={64} />
          <p>La mesa se ha cerrado. Las fichas han vuelto a tu monedero.</p>
          <button type="button" className="ptak-btn primary" onClick={onClose}>Volver al directo</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ptak-overlay" role="dialog" aria-modal="true" aria-label="Mesa de POKERTAK">
      <header className="ptak-head">
        <div className="ptak-head-title">
          <PokerTakLogo size={40} />
          <div>
            <strong className="ptak-name">POKERTAK</strong>
            <small className="ptak-tagline">Somos la PEPA DEL QUIERO</small>
          </div>
        </div>
        <div className="ptak-head-status">
          <span className="ptak-phase">{phaseLabel(state?.phase)}</span>
          {state && (
            <span className="ptak-pot">Bote 🪙 {formatCoins(state.pot)}</span>
          )}
          {voiceRoomInfo && (
            <button
              type="button"
              className={`ptak-btn ghost ${chatOpen ? 'on' : ''}`}
              onClick={() => setChatOpen((open) => !open)}
              aria-pressed={chatOpen}
              aria-label={chatOpen ? 'Ocultar comentarios' : 'Mostrar comentarios'}
            >
              💬
            </button>
          )}
          <button type="button" className="ptak-btn ghost" onClick={onClose} aria-label="Cerrar la mesa">
            ✕
          </button>
        </div>
      </header>

      {error && <p className="ptak-error" role="alert">{error}</p>}

      <div className="ptak-felt">
        {/* Centro de la mesa: el nombre, el eslogan y el logo, sobre el tapete. */}
        <div className="ptak-center">
          <PokerTakLogo size={92} className="ptak-center-logo" />
          <h2 className="ptak-center-name">POKERTAK</h2>
          <p className="ptak-center-tagline">Somos la PEPA DEL QUIERO</p>
          <div className="ptak-board">
            {(state?.board || []).map((c, i) => <PlayingCard key={i} label={c} />)}
            {(!state || state.board.length === 0) && (
              <span className="ptak-board-empty">La mesa está lista para repartir</span>
            )}
          </div>
          {state?.lastAction && <p className="ptak-last">{state.lastAction}</p>}
        </div>

        {/* Asientos alrededor. */}
        {positions.map((pos, seat) => (
          <Seat
            key={seat}
            player={state?.seats?.[seat]}
            position={pos}
            isTurn={state?.turnSeat === seat}
            isSelf={seat === mySeat}
            isWinner={state?.seats?.[seat] && winnerIds.has(String(state.seats[seat].userId))}
            face={faceFor.get(String(state?.seats?.[seat]?.userId))}
          />
        ))}

        {seated.length === 0 && (
          <div className="ptak-empty">
            <p>La mesa está vacía. Siéntate para empezar a jugar.</p>
          </div>
        )}

        {/* Comentarios de la mesa, sobre el tapete. Es el mismo hilo del directo,
            así que Asistak vigila lo que se dice jugando y deja aquí su aviso. */}
        {chatOpen && voiceRoomInfo && (
          <div className="ptak-chat">
            <LiveChat room={voiceRoomInfo.room} />
          </div>
        )}
      </div>

      <footer className="ptak-controls">
        {mySeat === -1 ? (
          <div className="ptak-buyin">
            <SitButtons emit={emit} slug={slug} state={state} busy={busy} setBusy={setBusy} setError={setError} />
          </div>
        ) : (
          <>
            <div className="ptak-actions">
              <button type="button" className="ptak-btn" disabled={!actions.canFold || busy} onClick={() => send('fold')}>
                Retirarse
              </button>
              {actions.canCheck && (
                <button type="button" className="ptak-btn" disabled={busy} onClick={() => send('check')}>
                  Pasar
                </button>
              )}
              {actions.canCall && (
                <button type="button" className="ptak-btn" disabled={busy} onClick={() => send('call')}>
                  Igualar {formatCoins(actions.toCall)}
                </button>
              )}
              {actions.canAllIn && (
                <button type="button" className="ptak-btn allin" disabled={busy} onClick={() => send('all-in')}>
                  All-in
                </button>
              )}
            </div>
            {actions.canRaise && (
              <div className="ptak-raise">
                <input
                  type="range"
                  min={actions.minRaiseTo}
                  max={actions.maxRaiseTo}
                  step={state?.bigBlind || 10}
                  value={raiseTo}
                  onChange={(e) => setRaiseTo(Number(e.target.value))}
                  aria-label="Importe de la subida"
                />
                <button
                  type="button"
                  className="ptak-btn primary"
                  disabled={busy}
                  onClick={() => send('raise', raiseTo)}
                >
                  Subir a {formatCoins(raiseTo)}
                </button>
              </div>
            )}
            {!actions.yourTurn && mySeat !== -1 && (
              <p className="ptak-wait">Esperando tu turno…</p>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

// Botones de entrada, con los importes de la mesa. La entrada se cobra en el
// servidor; aquí solo se elige el importe.
function SitButtons({ emit, slug, state, busy, setBusy, setError }) {
  const min = state?.minBuyIn ?? 200;
  const max = state?.maxBuyIn ?? 20000;
  const options = [min, Math.min(min * 5, max), max].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <>
      {options.map((amount) => (
        <button
          key={amount}
          type="button"
          className="ptak-btn primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            emit('poker:sit', { slug, buyIn: amount });
            setTimeout(() => setBusy(false), 400);
          }}
        >
          Sentarse con {formatCoins(amount)}
        </button>
      ))}
    </>
  );
}
