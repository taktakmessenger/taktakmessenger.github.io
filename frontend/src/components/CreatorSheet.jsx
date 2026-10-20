import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Hoja de contacto del creador. Se abre tocando su nombre en el reel y ofrece
// lo que pide la idea de WhaTaka: hablar o llamar sin salir del video que se
// está viendo. Es una acción contextual, no una pantalla nueva: el video sigue
// detrás y al cerrar se vuelve exactamente donde estaba.
export default function CreatorSheet({ creator, onClose, onMessage, onCall }) {
  const { user } = useAuth();
  const [following, setFollowing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSelf = user && (user.id === creator?._id || user.username === creator?.username);

  // El estado de seguimiento se consulta al abrir. Se pide el perfil público,
  // que ya devuelve los seguidores del creador.
  useEffect(() => {
    if (!creator?.username) return;
    let active = true;
    api
      .get(`/users/${creator.username}`)
      .then(({ data }) => {
        if (!active) return;
        const ids = (data?.user?.profile?.followers || []).map(String);
        setFollowing(user ? ids.includes(String(user.id)) : false);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [creator?.username, user]);

  // Escape cierra, como el resto de paneles de la app.
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggleFollow() {
    setBusy(true);
    setError('');
    try {
      if (following) {
        await api.delete(`/users/${creator.username}/follow`);
        setFollowing(false);
      } else {
        await api.post(`/users/${creator.username}/follow`);
        setFollowing(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Toda acción de contacto exige sesión: sin cuenta no hay a quién llamar ni
  // con qué identificarse en la señalización.
  function guard(action) {
    if (!user) {
      setError('Inicia sesión para contactar con el creador');
      return;
    }
    action();
  }

  if (!creator) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="creator-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Contactar con @${creator.username}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="creator-sheet-head">
          <span className="avatar">{creator.username?.slice(0, 2).toUpperCase()}</span>
          <div className="creator-sheet-id">
            <strong>@{creator.username}</strong>
            <small>{creator.profile?.displayName || 'Creador en TAK TAK'}</small>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✖
          </button>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="creator-sheet-actions">
          <button
            type="button"
            className="creator-action"
            onClick={() => guard(() => onMessage(creator))}
            disabled={isSelf}
          >
            <span aria-hidden="true">💬</span>
            <strong>Mensaje</strong>
            <small>Chatear en privado</small>
          </button>

          <button
            type="button"
            className="creator-action"
            onClick={() => guard(() => onCall(creator, 'audio'))}
            disabled={isSelf}
          >
            <span aria-hidden="true">📞</span>
            <strong>Llamada de voz</strong>
            <small>Hablar sin cámara</small>
          </button>

          <button
            type="button"
            className="creator-action"
            onClick={() => guard(() => onCall(creator, 'video'))}
            disabled={isSelf}
          >
            <span aria-hidden="true">🎥</span>
            <strong>Videollamada</strong>
            <small>Cara a cara</small>
          </button>
        </div>

        {isSelf ? (
          <p className="muted creator-sheet-note">Este perfil es tuyo.</p>
        ) : (
          <button
            type="button"
            className="btn-secondary creator-follow"
            onClick={() => guard(toggleFollow)}
            disabled={busy || following === null}
          >
            {following ? 'Dejar de seguir' : 'Seguir'}
          </button>
        )}
      </div>
    </div>
  );
}
