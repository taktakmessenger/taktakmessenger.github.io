import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { CallProvider, useCall } from './contexts/CallContext';
import { VoiceRoomProvider } from './contexts/VoiceRoomContext';
import Navigation from './components/Navigation';
import Splash from './components/Splash';
import Home from './components/Home';
import Upload from './components/Upload';
import Wallet from './components/Wallet';
import Profile from './components/Profile';
import AdminPanel from './components/AdminPanel';
import Squads from './components/Squads';
import Wall from './components/Wall';
import AccountHealth from './components/AccountHealth';
import Verification from './components/Verification';
import AuthForm from './components/AuthForm';
import Messages from './components/Messages';
import CallOverlay from './components/CallOverlay';
import Settings from './components/Settings';
import PhoneLink from './components/PhoneLink';
import NotificationPrompt from './components/NotificationPrompt';
import VoiceRoomBar from './components/VoiceRoomBar';
import Activity from './components/Activity';
import CoinStore from './components/CoinStore';
import PaymentResult from './components/PaymentResult';
import PaymentMethods from './components/PaymentMethods';
import api from './api/client';
import { syncPushSubscription } from './services/push.js';
import './styles/App.css';

// Sending a gift straight from the feed, priced by the server catalogue so the
// client never chooses what a gift costs.
function GiftModal({ video, onClose, onSent, onBuyCoins }) {
  const [gifts, setGifts] = useState([]);
  const [selected, setSelected] = useState('');
  const [coins, setCoins] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/gifts')
      .then(({ data }) => setGifts(data.gifts))
      .catch((err) => setError(err.message));
    // El saldo se enseña aquí porque es justo el dato que hace falta para
    // elegir un regalo. Sin él, el usuario solo descubre que no le llega
    // cuando el envío falla.
    // El saldo gastable suma monedas compradas y de regalo: un usuario nuevo
    // con bono debe poder regalar sin ver los regalos bloqueados.
    api
      .get('/wallet')
      .then(({ data }) => setCoins(data.spendable ?? data.coins))
      .catch(() => setCoins(null));
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
      // El saldo pudo cambiar en otro dispositivo: se relee para que la lista
      // refleje lo que de verdad queda.
      api
        .get('/wallet')
        .then(({ data }) => setCoins(data.spendable ?? data.coins))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const affordable = coins == null ? null : coins;
  const tooExpensive = (cost) => affordable != null && cost > affordable;

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-content">
        <h3>Enviar regalo a @{video.creator?.username}</h3>

        {coins != null && (
          <p className="gift-balance">
            Tienes <strong>{coins}</strong> monedas
            <button type="button" className="btn-link" onClick={onBuyCoins}>
              Comprar más
            </button>
          </p>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <div className="gift-grid">
          {gifts.map((g) => (
            <button
              key={g._id}
              type="button"
              className={`gift-option ${selected === g._id ? 'selected' : ''}`}
              onClick={() => setSelected(g._id)}
              disabled={tooExpensive(g.coinCost)}
              title={tooExpensive(g.coinCost) ? 'No te llegan las monedas' : undefined}
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
  // La portada de acceso es la entrada de quien no tiene sesión. A quien ya la
  // tiene se le deja en el feed: obligarle a pasar por el acceso sería un paso
  // de más en cada arranque.
  const [view, setView] = useState(() => (localStorage.getItem('taktak_token') ? 'feed' : 'acceso'));
  // El alta inicia sesión en el acto (el backend devuelve token al crear la
  // cuenta). Sin este pestillo, en cuanto `user` existe el formulario se
  // desmontaría y la pantalla de verificación del correo, que vive dentro del
  // formulario, no llegaría a verse nunca. Se baja al terminar el flujo.
  const [authOpen, setAuthOpen] = useState(false);
  const [giftTarget, setGiftTarget] = useState(null);
  const [paymentProvider, setPaymentProvider] = useState('stripe');
  // Orden de PayPal que hay que confirmar al volver de la aprobación.
  const [paypalLinkOrder, setPaypalLinkOrder] = useState(null);
  // Usuario con el que se quiere abrir un chat desde el feed. Se pasa a
  // Mensajes para que abra el hilo directamente en vez de dejar al usuario
  // buscándolo a mano en la bandeja.
  const [chatTarget, setChatTarget] = useState(null);
  // Invitación a vincular el teléfono, una sola vez por cuenta. Muchas cuentas
  // se crean por correo y quedan sin número: sin teléfono no se las puede llamar
  // desde el marcador. Se muestra una vez y se recuerda el descarte para no
  // insistir en cada inicio de sesión.
  const [phonePrompt, setPhonePrompt] = useState(false);
  const { user, loading } = useAuth();
  const { startCall } = useCall();

  // Anything other than the feed needs a session.
  const needsAuth = ['upload', 'wallet', 'profile', 'admin', 'squads', 'health', 'messages', 'verification', 'settings', 'activity', 'tienda', 'pago-exito'].includes(view);

  useEffect(() => {
    if (!user || user.phoneVerified) return;
    const seen = localStorage.getItem(`taktak_phone_prompt_${user.id}`);
    if (!seen) setPhonePrompt(true);
  }, [user]);

  // Pedir una vista protegida sin sesión abre el formulario y lo deja abierto
  // hasta que el flujo termina. Sin levantarlo aquí, el alta que acaba de crear
  // la sesión cerraría el formulario en el acto y se perdería la pantalla de
  // verificación del correo.
  useEffect(() => {
    if (needsAuth && !user) setAuthOpen(true);
  }, [needsAuth, user]);

  // Abrir una pantalla directamente cuando se llega desde fuera: el push de un
  // aviso (`/?view=activity`) o la vuelta de una pasarela de pago
  // (`/?view=pago-exito`). Se lee una sola vez, al arrancar: a partir de ahí
  // manda el estado, no la URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('view');
    if (target === 'activity') setView('activity');
    if (target === 'wall') setView('wall');
    if (target === 'pago-exito') {
      setPaymentProvider(params.get('provider') || 'stripe');
      setView('pago-exito');
    }
    // Vuelta de la vinculación de PayPal: PayPal añade `token=<orden>` a la URL
    // de retorno. Ese token es el id de la orden, y hay que confirmarlo para
    // guardar el método. Se guarda aquí y la pantalla lo confirma al montarse.
    if (params.get('link') === '1' && params.get('token')) {
      setPaypalLinkOrder(params.get('token'));
      setView('metodos-pago');
    }
    if (target === 'metodos-pago') setView('metodos-pago');
  }, []);

  function dismissPhonePrompt() {
    if (user) localStorage.setItem(`taktak_phone_prompt_${user.id}`, '1');
    setPhonePrompt(false);
  }

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

  function renderView() {
    // Pedir una vista protegida sin sesión abre el formulario de acceso ya
    // desplegado: la portada de bienvenida es para la entrada a la app, no para
    // volver a verla cada vez que se pulsa una pestaña que pide cuenta.
    //
    // `authOpen` mantiene el formulario en pantalla mientras el flujo de alta
    // sigue (verificación del correo), aunque la sesión ya exista.
    if ((needsAuth && !user) || authOpen) {
      return (
        <AuthForm
          initialView="login"
          onDone={() => {
            setAuthOpen(false);
            setView('feed');
          }}
          // Sin salida a invitado, quien llegó aquí pulsando una pestaña
          // protegida no tendría forma de volver al feed sin crear cuenta.
          onGuest={() => {
            setAuthOpen(false);
            setView('feed');
          }}
        />
      );
    }

    if (view === 'acceso') {
      return (
        <AuthForm
          initialView="welcome"
          onDone={() => setView('feed')}
          onGuest={() => setView('feed')}
        />
      );
    }

    switch (view) {
      case 'upload':
        return <Upload onUploaded={() => setView('feed')} />;
      case 'wallet':
        return <Wallet onBack={() => setView('settings')} onNavigate={setView} />;
      case 'tienda':
        return (
          <CoinStore
            onBack={() => setView('wallet')}
            onPurchased={() => setView('wallet')}
            onManageMethods={() => setView('metodos-pago')}
          />
        );
      case 'pago-exito':
        return <PaymentResult provider={paymentProvider} onDone={() => setView('wallet')} />;
      case 'metodos-pago':
        return (
          <PaymentMethods
            onBack={() => setView('wallet')}
            paypalOrderId={paypalLinkOrder}
            onPaypalConfirmed={() => setPaypalLinkOrder(null)}
          />
        );
      case 'profile':
        return <Profile onNavigate={setView} />;
      case 'settings':
        return <Settings onBack={() => setView('profile')} onNavigate={setView} />;
      case 'squads':
        return <Squads />;
      case 'wall':
        // Facetak es de lectura pública, como el feed: un visitante puede verlo.
        // Para publicar o comentar se le pide la sesión desde el propio Facetak.
        return <Wall onOpenProfile={() => setView('profile')} />;
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
      case 'activity':
        return (
          <Activity
            onBack={() => setView('feed')}
            onOpenVideo={() => setView('feed')}
            onOpenProfile={() => setView('profile')}
            onOpenWall={() => setView('wall')}
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
          <Home
            onGiftRequest={openGift}
            onCall={callPeer}
            onMessage={messageCreator}
            onOpenProfile={() => setView('profile')}
          />
        );
    }
  }

  return (
    <div className={`app ${view === 'feed' ? 'app-feed' : ''}`}>
      <main className="main-content">{renderView()}</main>

      {/* La barra inferior no se muestra en la portada: no hay a dónde ir
          todavía y las pestañas ofrecerían pantallas que piden sesión. */}
      {view !== 'acceso' && <Navigation currentView={view} setCurrentView={setView} />}

      {giftTarget && user && (
        <GiftModal
          video={giftTarget}
          onClose={() => setGiftTarget(null)}
          onSent={() => setView('wallet')}
          onBuyCoins={() => {
            setGiftTarget(null);
            setView('tienda');
          }}
        />
      )}

      {/* La pantalla de llamada vive fuera de las vistas: una llamada entrante
          debe verse sin cambiar de pestaña. */}
      <CallOverlay />

      {/* La barra de la sala de voz también vive fuera de las vistas: si se
          desmontara al cambiar de pestaña, el audio remoto se cortaría. Es lo
          que permite seguir en el feed mientras hablas con tu creator. */}
      {user && <VoiceRoomBar />}

      {/* Se ofrece una sola vez tras entrar con correo o Google, porque esas
          cuentas no tienen teléfono y sin él no se las puede llamar por número.
          Es opcional y descartable: obligar a dar el teléfono para usar la app
          espantaría a quien solo quiere ver vídeos. */}
      {phonePrompt && user && !user.phoneVerified && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <h3>¿Añades tu teléfono?</h3>
            <PhoneLink
              onDone={dismissPhonePrompt}
              onSkip={dismissPhonePrompt}
              skipLabel="Ahora no"
            />
          </div>
        </div>
      )}

      {/* Aviso para activar las notificaciones. Es lo que hace que una llamada
          suene con la app cerrada; sin suscripción, el servidor no tiene a quién
          despertar y la llamada acaba en "no está disponible".
          En WhaTaka no se dibuja: es una tarjeta anclada abajo y ahí choca con
          el compositor del chat y con el teclado del marcador. Ya se ofrece al
          entrar, sobre el feed, así que quien lo quiera activar lo ve igual. */}
      {user && view !== 'messages' && (
        <NotificationPrompt user={user} onOpenSettings={() => setView('settings')} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <CallProvider>
          <VoiceRoomProvider>
            <Shell />
          </VoiceRoomProvider>
        </CallProvider>
      </SocketProvider>
    </AuthProvider>
  );
}
