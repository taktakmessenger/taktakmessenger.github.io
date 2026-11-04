import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import AsistakLogo from './AsistakLogo';
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
//
// Los asientos vacíos no se esconden: se pintan con el mismo óvalo (en hueco)
// para que la mesa enseñe siempre las seis plazas, como una mesa de póker real.
function Seat({ player, position, isTurn, isSelf, isWinner, face, isButton, seatNumber }) {
  const empty = !player || player.empty;
  const style = { left: `${position.x}%`, top: `${position.y}%` };

  if (empty) {
    return (
      <div
        className="ptak-seat empty"
        style={style}
        data-seat={seatNumber}
        aria-label={`Asiento ${seatNumber + 1} libre`}
      >
        <div className="ptak-face empty" aria-hidden="true">
          <span className="ptak-face-plus">+</span>
        </div>
        <div className="ptak-seat-info">
          <span className="ptak-seat-free">Libre</span>
        </div>
      </div>
    );
  }

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
      style={style}
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
      {isButton && <span className="ptak-seat-dealer" aria-label="Botón del repartidor">D</span>}
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
  // Menú de tres puntos de la cabecera: en un móvil no caben los botones
  // sueltos, así que el chat y el cerrar viven aquí dentro.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const menuPanelRef = useRef(null);

  // El menú de tres puntos se cierra al tocar fuera, con Escape o al cambiar el
  // tamaño. El panel vive fuera de la cabecera porque esta recorta lo que
  // sobresale (`overflow: hidden`) y el desplegable quedaba tapado por la mesa.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onDown = (e) => {
      if (menuBtnRef.current?.contains(e.target)) return;
      if (menuPanelRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', close);
    };
  }, [menuOpen]);

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
  // Solo el anfitrión (el dueño del directo) reparte, y solo entre manos: cuando
  // la mesa está esperando o se acaba de resolver la anterior. Así el botón de
  // Asistak no aparece a mitad de una mano ni a los invitados.
  const canDeal =
    mySeat !== -1 &&
    String(state?.hostId) === String(user?.id) &&
    (state?.phase === 'waiting' || state?.phase === 'showdown') &&
    (state?.seats || []).filter((s) => s && !s.empty && s.stack > 0).length >= 2;

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
          <PokerTakLogo size={34} />
          <strong className="ptak-name">POKERTAK</strong>
        </div>
        {/* Estado en una fila que no desborda: fase, bote y un menú. En pantalla
            de móvil el nombre del eslogan y los botones sueltos no caben, así que
            el chat y el cerrar viven dentro del menú de tres puntos. */}
        <div className="ptak-head-status">
          <span className="ptak-phase">{phaseLabel(state?.phase)}</span>
          {state && <span className="ptak-pot">🪙 {formatCoins(state.pot)}</span>}
          <div className="ptak-menu-wrap" ref={menuBtnRef}>
            <button
              type="button"
              className="ptak-btn ghost ptak-menu-btn"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Más opciones de la mesa"
            >
              ⋯
            </button>
          </div>
        </div>
      </header>

      {/* El menú se dibuja en un portal colgado de <body>, fuera de la mesa y de
          la cabecera. Así ningún contenedor con `overflow: hidden` puede
          recortarlo (era lo que lo dejaba por detrás del tapete) ni ninguna capa
          con `transform` puede romper su `position: fixed`. */}
      {menuOpen && createPortal(
        <div className="ptak-menu" role="menu" ref={menuPanelRef}>
          {voiceRoomInfo && (
            <button
              type="button"
              role="menuitem"
              className={`ptak-menu-item${chatOpen ? ' on' : ''}`}
              onClick={() => { setChatOpen((open) => !open); setMenuOpen(false); }}
            >
              💬 {chatOpen ? 'Ocultar comentarios' : 'Ver comentarios'}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="ptak-menu-item"
            onClick={() => { setMenuOpen(false); onClose(); }}
          >
            ✕ Cerrar la mesa
          </button>
        </div>,
        document.body,
      )}

      {error && <p className="ptak-error" role="alert">{error}</p>}

      <div className="ptak-felt">
        {/* Centro de la mesa: el logo, el nombre, el eslogan, el repartidor y las
            cartas comunitarias. El repartidor es Asistak: cuida la mesa y lleva
            las cartas, como se pidió. */}
        <div className="ptak-center">
          <PokerTakLogo size={64} className="ptak-center-logo" />
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

        {/* Asistak, el repartidor: ficha fija al pie del tapete, con su cara y su
            pajarita. Reparte y vigila el juego. */}
        <div className="ptak-dealer" aria-label="Asistak, el repartidor de la mesa">
          <AsistakLogo size={40} className="ptak-dealer-face" />
          <span className="ptak-dealer-name">Asistak</span>
          <span className="ptak-dealer-role">Repartidor</span>
        </div>

        {/* Asientos alrededor. Se pintan siempre las seis plazas: las libres en
            hueco, para que la mesa muestre su forma de óvalo completa. */}
        {positions.map((pos, seat) => (
          <Seat
            key={seat}
            seatNumber={seat}
            player={state?.seats?.[seat]}
            position={pos}
            isTurn={state?.turnSeat === seat}
            isSelf={seat === mySeat}
            isButton={state?.buttonSeat === seat}
            isWinner={state?.seats?.[seat] && winnerIds.has(String(state.seats[seat].userId))}
            face={faceFor.get(String(state?.seats?.[seat]?.userId))}
          />
        ))}

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
            {/* Asistak reparte: entre manos, el anfitrión pide la siguiente y la
                mesa vuelve a jugar. Va con la cara del repartidor para que quede
                claro quién da las cartas. */}
            {canDeal && (
              <div className="ptak-deal">
                <AsistakLogo size={26} />
                <button
                  type="button"
                  className="ptak-btn primary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    emit('poker:start', {});
                    setTimeout(() => setBusy(false), 500);
                  }}
                >
                  {state?.handNumber ? 'Repartir otra mano' : 'Repartir las cartas'}
                </button>
              </div>
            )}
            {/* Las tres acciones de siempre, siempre en el mismo sitio: retirarse,
                igualar/pasar y subir (o all-in). Cuando no es tu turno se ven
                apagadas en vez de desaparecer, para que la mesa no cambie de
                forma bajo el dedo. */}
            <div className="ptak-actions">
              <button
                type="button"
                className="ptak-btn fold"
                disabled={!actions.canFold || busy}
                onClick={() => send('fold')}
              >
                Retirarse
              </button>
              <button
                type="button"
                className="ptak-btn call"
                disabled={!(actions.canCheck || actions.canCall) || busy}
                onClick={() => send(actions.canCall ? 'call' : 'check')}
              >
                {actions.canCall ? `Igualar ${formatCoins(actions.toCall)}` : 'Pasar'}
              </button>
              {/* Subir y all-in comparten hueco: si hay sitio para una subida de
                  verdad se enseña el control de importe; si no, el atajo de
                  all-in. Así el botón de la derecha nunca falta. */}
              {actions.canRaise ? (
                <button
                  type="button"
                  className="ptak-btn primary raise"
                  disabled={busy}
                  onClick={() => send('raise', raiseTo)}
                >
                  Subir a {formatCoins(raiseTo)}
                </button>
              ) : (
                <button
                  type="button"
                  className="ptak-btn allin"
                  disabled={!actions.canAllIn || busy}
                  onClick={() => send('all-in')}
                >
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
              </div>
            )}
            {!actions.yourTurn && !canDeal && (
              <p className="ptak-wait">Esperando tu turno…</p>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

// Botones de entrada, con los importes de la mesa. La entrada se cobra en el
// servidor; aquí solo se elige el importe. El mínimo (10) es accesible para
// cualquiera, incluso con el bono de bienvenida, y cada jugador puede subir el
// importe a su gusto hasta el máximo de la mesa.
function SitButtons({ emit, slug, state, busy, setBusy, setError }) {
  const min = state?.minBuyIn ?? 10;
  const max = state?.maxBuyIn ?? 20000;
  const [amount, setAmount] = useState(min);

  // Si cambia el mínimo de la mesa (o llega el estado por primera vez), el
  // importe se recoloca dentro de rango para no ofrecer un valor inválido.
  useEffect(() => {
    setAmount((current) => Math.min(Math.max(current, min), max));
  }, [min, max]);

  const quick = [min, Math.min(min * 10, max), Math.min(min * 50, max), max]
    .filter((v, i, a) => a.indexOf(v) === i);

  const sit = (value) => {
    setBusy(true);
    setError('');
    emit('poker:sit', { slug, buyIn: value });
    setTimeout(() => setBusy(false), 400);
  };

  return (
    <>
      <div className="ptak-buyin-quick">
        {quick.map((value) => (
          <button
            key={value}
            type="button"
            className="ptak-btn"
            disabled={busy}
            onClick={() => setAmount(value)}
          >
            {formatCoins(value)}
          </button>
        ))}
      </div>
      <div className="ptak-buyin-custom">
        <label htmlFor="ptak-buyin-range">Entrada: 🪙 {formatCoins(amount)}</label>
        <input
          id="ptak-buyin-range"
          type="range"
          min={min}
          max={max}
          step={min}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Importe de la entrada"
        />
      </div>
      <button type="button" className="ptak-btn primary" disabled={busy} onClick={() => sit(amount)}>
        Sentarse con {formatCoins(amount)}
      </button>
    </>
  );
}
