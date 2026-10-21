import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { CallProvider, useCall } from './contexts/CallContext';
import Navigation from './components/Navigation';
import Splash from './components/Splash';
import Feed from './components/Feed';
import Upload from './components/Upload';
import Wallet from './components/Wallet';
import Profile from './components/Profile';
import AdminPanel from './components/AdminPanel';
import Squads from './components/Squads';
import AccountHealth from './components/AccountHealth';
import Verification from './components/Verification';
import AuthForm from './components/AuthForm';
import Messages from './components/Messages';
import CallOverlay from './components/CallOverlay';
import Settings from './components/Settings';
import api from './api/client';
import { syncPushSubscription } from './services/push.js';
import './styles/App.css';

// Sending a gift straight from the feed, priced by the server catalogue so the
// client never chooses what a gift costs.
function GiftModal({ video, onClose, onSent }) {
  const [gifts, setGifts] = useState([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/gifts')
      .then(({ data }) => setGifts(data.gifts))
      .catch((err) => setError(err.message));
  }, []);

  async function send() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/wallet/gift', { recipientId: video.creator._id, giftId: selected, videoId: video._id });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-content">
        <h3>Enviar regalo a @{video.creator?.username}</h3>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="gift-grid">
          {gifts.map((g) => (
            <button
              key={g._id}
              type="button"
              className={`gift-option ${selected === g._id ? 'selected' : ''}`}
              onClick={() => setSelected(g._id)}
            >
              <span aria-hidden="true">🎁</span>
              <strong>{g.name}</strong>
              <small>{g.coinCost} monedas</small>
            </button>
          ))}
        </div>
        <div className="modal-buttons">
          <button type="button" className="btn-primary" onClick={send} disabled={busy || !selected}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const [view, setView] = useState('feed');
  const [giftTarget, setGiftTarget] = useState(null);
  // Usuario con el que se quiere abrir un chat desde el feed. Se pasa a
  // Mensajes para que abra el hilo directamente en vez de dejar al usuario
  // buscándolo a mano en la bandeja.
  const [chatTarget, setChatTarget] = useState(null);
  const { user, loading } = useAuth();
  const { startCall } = useCall();

  // Al haber sesión, se reenvía al servidor la suscripción push que este
  // navegador ya tuviera. El servidor guarda qué dispositivo pertenece a qué
  // cuenta, así que tras un cambio de usuario hay que reasociarla; si no, las
  // llamadas sonarían en el teléfono de quien entró antes.
  useEffect(() => {
    if (user) syncPushSubscription();
  }, [user]);

  // Iniciar una llamada desde el chat o desde el feed. Se cierra el aviso de
  // error anterior para que un fallo viejo no se confunda con el estado de la
  // llamada nueva.
  const callPeer = useCallback(
    (person, kind) => {
      if (person?.id || person?._id) {
        startCall({ ...person, id: person.id || person._id }, kind);
      }
    },
    [startCall]
  );

  // Abrir el chat con un creador concreto desde el reel.
  const messageCreator = useCallback(
    (creator) => {
      setChatTarget(creator);
      setView('messages');
    },
    []
  );

  // Opening the gift modal from the feed requires a session; an anonymous
  // visitor is sent to the sign-in form instead of seeing nothing happen.
  const openGift = useCallback(
    (video) => {
      if (!user) {
        setView('wallet');
        return;
      }
      if (video?.creator) setGiftTarget(video);
    },
    [user]
  );

  if (loading) {
    return <Splash />;
  }

  // Anything other than the feed needs a session.
  const needsAuth = ['upload', 'wallet', 'profile', 'admin', 'squads', 'health', 'messages', 'verification', 'settings'].includes(view);

  function renderView() {
    if (needsAuth && !user) return <AuthForm onDone={() => setView('feed')} />;

    switch (view) {
      case 'upload':
        return <Upload onUploaded={() => setView('feed')} />;
      case 'wallet':
        return <Wallet onBack={() => setView('settings')} />;
      case 'profile':
        return <Profile onNavigate={setView} />;
      case 'settings':
        return <Settings onBack={() => setView('profile')} onNavigate={setView} />;
      case 'squads':
        return <Squads />;
      case 'health':
        return <AccountHealth onBack={() => setView('settings')} />;
      case 'verification':
        return <Verification onBack={() => setView('settings')} />;
      case 'messages':
        return (
          <Messages
            onCall={callPeer}
            initialUser={chatTarget}
            onConsumeInitialUser={() => setChatTarget(null)}
          />
        );
      case 'admin':
        return user?.role === 'admin' ? (
          <AdminPanel />
        ) : (
          <div className="centered">No tienes acceso al panel de administración.</div>
        );
      default:
        return (
          <Feed
            onGiftRequest={openGift}
            onCall={callPeer}
            onMessage={messageCreator}
          />
        );
    }
  }

  return (
    <div className={`app ${view === 'feed' ? 'app-feed' : ''}`}>
      <main className="main-content">{renderView()}</main>
      <Navigation currentView={view} setCurrentView={setView} />

      {giftTarget && user && (
        <GiftModal
          video={giftTarget}
          onClose={() => setGiftTarget(null)}
          onSent={() => setView('wallet')}
        />
      )}

      {/* La pantalla de llamada vive fuera de las vistas: una llamada entrante
          debe verse sin cambiar de pestaña. */}
      <CallOverlay />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <CallProvider>
          <Shell />
        </CallProvider>
      </SocketProvider>
    </AuthProvider>
  );
}
