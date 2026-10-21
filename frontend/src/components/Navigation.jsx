import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../api/client';

const TABS = [
  { id: 'feed', label: 'Inicio', icon: '🏠' },
  { id: 'squads', label: 'Squads', icon: '👥' },
  { id: 'upload', label: 'Subir', icon: '＋', primary: true },
  { id: 'messages', label: 'WhaTaka', icon: '💬' },
  { id: 'profile', label: 'Perfil', icon: '👤' },
];

// Cada sección tiene su propia pantalla. Antes había ocho pestañas apiladas en
// la barra y todo caía en la misma columna; ahora la barra lleva lo que se usa
// a diario y el resto vive dentro del perfil, que es como lo hace TikTok.
export default function Navigation({ currentView, setCurrentView }) {
  const { user } = useAuth();
  const { subscribe } = useSocket();
  const [unread, setUnread] = useState(0);

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
    const unsubscribe = subscribe('chat:notify', refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, subscribe, currentView]);

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tabbar-btn ${currentView === tab.id ? 'active' : ''} ${
            tab.primary ? 'primary' : ''
          }`}
          onClick={() => setCurrentView(tab.id)}
          aria-current={currentView === tab.id ? 'page' : undefined}
        >
          <span className="tabbar-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="tabbar-label">{tab.label}</span>
          {tab.id === 'messages' && unread > 0 && (
            <span className="nav-badge" aria-label={`${unread} sin leer`}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
