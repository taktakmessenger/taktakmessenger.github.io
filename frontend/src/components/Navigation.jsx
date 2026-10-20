import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../api/client';

const TABS = [
  { id: 'feed', label: 'Inicio', icon: '🏠' },
  { id: 'messages', label: 'Mensajes', icon: '💬' },
  { id: 'upload', label: 'Subir', icon: '⬆️' },
  { id: 'squads', label: 'Squads', icon: '👥' },
  { id: 'wallet', label: 'Wallet', icon: '💰' },
  { id: 'health', label: 'Salud', icon: '🔍' },
  { id: 'verification', label: 'Verificar', icon: '🛡️' },
  { id: 'profile', label: 'Perfil', icon: '👤' },
];

export default function Navigation({ currentView, setCurrentView }) {
  const { user, logout } = useAuth();
  const { subscribe } = useSocket();
  const [unread, setUnread] = useState(0);

  const tabs = user?.role === 'admin'
    ? [...TABS, { id: 'admin', label: 'Admin', icon: '🛡️' }]
    : TABS;

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
    <nav className="nav">
      <div className="nav-brand" onClick={() => setCurrentView('feed')}>
        <svg className="nav-logo" viewBox="0 0 64 64" role="img" aria-label="TAK TAK">
          <defs>
            <linearGradient id="nav-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff2d8d" />
              <stop offset="55%" stopColor="#b04bfb" />
              <stop offset="100%" stopColor="#00f7d4" />
            </linearGradient>
          </defs>
          <g fill="url(#nav-mark)">
            <rect x="12" y="19" width="18" height="4.6" rx="2.3" />
            <rect x="18.7" y="19" width="4.6" height="26" rx="2.3" />
            <rect x="34" y="19" width="18" height="4.6" rx="2.3" />
            <rect x="40.7" y="19" width="4.6" height="26" rx="2.3" />
          </g>
        </svg>
        <span className="nav-wordmark">TAK TAK</span>
      </div>

      <div className="nav-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`nav-tab ${currentView === tab.id ? 'active' : ''}`}
            onClick={() => setCurrentView(tab.id)}
          >
            <span aria-hidden="true">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
            {tab.id === 'messages' && unread > 0 && (
              <span className="nav-badge" aria-label={`${unread} sin leer`}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="nav-user">
        {user ? (
          <>
            <span className="nav-username">@{user.username}</span>
            <button type="button" className="btn-ghost" onClick={logout}>
              Salir
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setCurrentView('wallet')}
          >
            Entrar
          </button>
        )}
      </div>
    </nav>
  );
}
