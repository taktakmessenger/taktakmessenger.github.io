import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../api/client';
import { pulseIcon } from '../lib/tapFx';

// Barra superior de la app: la campana de avisos y la lupa de buscar, las dos
// arriba y fuera de la barra inferior.
//
// Estaban repartidas: la campana era una pestaña más abajo y la lupa solo vivía
// en el feed. Al subirlas juntas se libera un hueco abajo para la pestaña del
// juego (POKERTAK) y las dos acciones quedan a la vista desde cualquier pantalla,
// que es lo que son: acciones, no secciones.
export default function AppTopBar({ currentView, onOpenActivity, onSearch }) {
  const { user } = useAuth();
  const { subscribe } = useSocket();
  const [alerts, setAlerts] = useState(0);

  // El contador se lee del servidor al arrancar y se sube solo cuando llega un
  // aviso por socket; no se incrementa con cada evento para no desincronizarse.
  useEffect(() => {
    if (!user) {
      setAlerts(0);
      return undefined;
    }
    let active = true;
    api
      .get('/notifications/unread-count')
      .then(({ data }) => { if (active) setAlerts(Number(data?.unread) || 0); })
      .catch(() => {});
    const unsubscribe = subscribe('notification:new', () => {
      // La campana se menea al llegar el aviso: se ve sin mirar el contador.
      pulseIcon('🔔');
      setAlerts((prev) => prev + 1);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user, subscribe, currentView]);

  if (!user) return null;

  // En el feed la barra va a la izquierda: arriba a la derecha vive el botón de
  // sonido del reel. En el resto de pantallas va a la derecha, que es donde no
  // hay nada (las cabeceras llevan el volver a la izquierda).
  const side = currentView === 'feed' ? 'app-topbar--left' : 'app-topbar--right';

  return (
    <div className={`app-topbar ${side}`}>
      <button
        type="button"
        className={`app-topbar-btn ${currentView === 'activity' ? 'active' : ''}`}
        onClick={onOpenActivity}
        aria-label={alerts > 0 ? `Notificaciones, ${alerts} sin leer` : 'Notificaciones'}
        title="Notificaciones"
      >
        <span aria-hidden="true">🔔</span>
        {alerts > 0 && <span className="nav-badge" aria-hidden="true">{alerts > 9 ? '9+' : alerts}</span>}
      </button>
      <button
        type="button"
        className="app-topbar-btn"
        onClick={onSearch}
        aria-label="Buscar"
        title="Buscar"
      >
        <span aria-hidden="true">🔎</span>
      </button>
    </div>
  );
}
