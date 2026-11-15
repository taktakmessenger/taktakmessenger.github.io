import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import PokerTakLogo from './PokerTakLogo';
import Fireworks, { useFireworks, celebrate } from './Fireworks';
import api from '../api/client';
import { pulseIcon } from '../lib/tapFx';

const TABS = [
  { id: 'feed', label: 'Inicio', icon: '🏠' },
  { id: 'wall', label: 'Facetak', icon: '📰' },
  // El nombre de la pestaña va en inglés a propósito: es la marca del producto
  // ("TAK Live Creator"), no una traducción de la interfaz.
  { id: 'squads', label: 'TAK Live Creator', icon: '👥' },
  { id: 'upload', label: 'Subir', icon: '＋', primary: true },
  // El juego de Tak, con su propio emblema (el queso con la semilla de mango).
  { id: 'poker', label: 'POKERTAK', poker: true },
  { id: 'messages', label: 'TakTak Móvil', icon: '💬' },
  { id: 'profile', label: 'Perfil', icon: '👤' },
];

// Cada sección tiene su propia pantalla. La barra lleva lo que se usa a diario y
// el resto vive dentro del perfil, que es como lo hace TikTok. La campana de
// avisos ya no está aquí: subió a la barra superior, junto a la lupa, para dejar
// hueco a la pestaña del juego.
export default function Navigation({ currentView, setCurrentView }) {
  const { user } = useAuth();
  const { subscribe } = useSocket();
  const [unread, setUnread] = useState(0);
  // Fuegos artificiales del botón POKERTAK: al tocar la pestaña que abre el
  // juego, las cartas del emblema se levantan y estallan los fuegos. La capa se
  // pinta por encima de todo y se apaga sola.
  const { bursts, fire } = useFireworks();
  const [pokerPlaying, setPokerPlaying] = useState(false);

  const tabs = TABS;

  // El contador se recalcula desde la bandeja en lugar de incrementarse a mano:
  // así nunca se desincroniza si llegan mensajes desde otra pestaña o si el
  // usuario los lee en el móvil.
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return undefined;
    }

    let active = true;
    const refresh = () => {
      api
        .get('/messages/conversations')
        .then(({ data }) => {
          if (!active) return;
          const total = (Array.isArray(data?.conversations) ? data.conversations : [])
            .reduce((sum, c) => sum + (c.unread || 0), 0);
          setUnread(total);
        })
        .catch(() => {});
    };

    refresh();
    // Al llegar un mensaje, además de refrescar el contador, el icono de TakTak
    // Móvil se retuerce: el aviso se "siente" sin abrir la conversación.
    const unsubscribe = subscribe('chat:notify', () => {
      pulseIcon('💬');
      refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, subscribe, currentView]);

  // Tocar el botón POKERTAK (el de la barra inferior) abre el juego y, de paso,
  // celebra la entrada: las cartas del emblema se levantan y salen fuegos desde
  // el propio botón. El evento da la posición para que estallen justo ahí.
  const openPoker = useCallback(
    (event) => {
      setCurrentView('poker');
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX || rect.left + rect.width / 2;
      const y = event.clientY || rect.top + rect.height / 2;
      celebrate(fire, x, y);
      setPokerPlaying(true);
      setTimeout(() => setPokerPlaying(false), 900);
    },
    [fire, setCurrentView],
  );

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tabbar-btn ${currentView === tab.id ? 'active' : ''} ${
            tab.primary ? 'primary' : ''
          } ${tab.poker && pokerPlaying ? 'poker-playing' : ''}`}
          onClick={tab.poker ? openPoker : () => setCurrentView(tab.id)}
          aria-current={currentView === tab.id ? 'page' : undefined}
        >
          <span className="tabbar-icon" aria-hidden="true">
            {tab.poker ? (
              <PokerTakLogo size={24} className="tabbar-poker-logo" playing={pokerPlaying} />
            ) : (
              tab.icon
            )}
          </span>
          <span className="tabbar-label">{tab.label}</span>
          {tab.id === 'messages' && unread > 0 && (
            <span className="nav-badge" aria-label={`${unread} sin leer`}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      ))}
      {/* Los fuegos del botón POKERTAK, en una capa fija por encima de todo. */}
      <Fireworks bursts={bursts} />
    </nav>
  );
}
