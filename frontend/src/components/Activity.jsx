import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

// Pantalla de actividad: regalos, seguidores, me gusta y comentarios.
//
// Es la otra mitad de la campana. La campana avisa de que hay algo; aquí es
// donde se ve qué es. Cada aviso se puede tocar para ir a su origen (el vídeo o
// el perfil), porque un aviso que no lleva a ninguna parte obliga a buscarlo a
// mano.

const ICONS = {
  gift: '🎁',
  follow: '👤',
  like: '❤️',
  comment: '💬',
  reply: '↩️',
};

function textFor(n) {
  const who = n.actor?.displayName || (n.actor?.username ? `@${n.actor.username}` : 'Alguien');
  switch (n.type) {
    case 'gift':
      return (
        <>
          <strong>{who}</strong> te envió {n.giftName || 'un regalo'}
          {n.amount ? <span className="activity-amount"> · {n.amount} TTC-C</span> : null}
        </>
      );
    case 'follow':
      return (
        <>
          <strong>{who}</strong> empezó a seguirte
        </>
      );
    case 'like':
      return (
        <>
          <strong>{who}</strong> le gustó tu vídeo
        </>
      );
    case 'comment':
      return (
        <>
          <strong>{who}</strong> comentó: <span className="activity-preview">{n.preview}</span>
        </>
      );
    case 'reply':
      return (
        <>
          <strong>{who}</strong> respondió: <span className="activity-preview">{n.preview}</span>
        </>
      );
    default:
      return (
        <>
          <strong>{who}</strong> hizo algo
        </>
      );
  }
}

// "hace 5 min", "ayer"… Fechas relativas porque en una lista de actividad lo que
// importa es la antigüedad, no el instante exacto.
function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return new Date(iso).toLocaleDateString();
}

export default function Activity({ onBack, onOpenVideo, onOpenProfile }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextCursor) => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 20 };
      if (nextCursor) params.cursor = nextCursor;
      const { data } = await api.get('/notifications', { params });
      const batch = Array.isArray(data?.notifications) ? data.notifications : [];
      setItems((prev) => (nextCursor ? [...prev, ...batch] : batch));
      setCursor(data?.nextCursor || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, user]);

  // Abrir la pantalla es el gesto de "me he enterado": se marca todo como leído
  // al entrar, que es lo que hace que la campana se apague.
  useEffect(() => {
    if (!user) return;
    api.post('/notifications/read-all').catch(() => {});
  }, [user]);

  function openTarget(n) {
    if (n.video?._id && onOpenVideo) {
      onOpenVideo(n.video._id);
      return;
    }
    if (n.actor?._id && onOpenProfile) onOpenProfile(n.actor);
  }

  return (
    <div className="activity">
      <div className="screen-head">
        <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h2>Actividad</h2>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 && !loading && (
        <p className="muted">
          Todavía no tienes actividad. Cuando alguien te regale algo, te siga o comente, lo verás
          aquí.
        </p>
      )}

      <ul className="activity-list">
        {items.map((n) => (
          <li key={n._id}>
            <button
              type="button"
              className={`activity-row ${n.read ? '' : 'unread'}`}
              onClick={() => openTarget(n)}
              disabled={!n.video?._id && !n.actor?._id}
            >
              <span className="activity-icon" aria-hidden="true">
                {ICONS[n.type] || '🔔'}
              </span>
              <span className="activity-body">
                <span className="activity-text">{textFor(n)}</span>
                <span className="activity-time">{relativeTime(n.createdAt)}</span>
              </span>
              {n.video?.thumbnailUrl && (
                <img className="activity-thumb" src={n.video.thumbnailUrl} alt="" loading="lazy" />
              )}
            </button>
          </li>
        ))}
      </ul>

      {cursor && (
        <div className="activity-more">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => load(cursor)}
            disabled={loading}
          >
            {loading ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}

      {loading && items.length === 0 && <p className="muted">Cargando actividad…</p>}
    </div>
  );
}
