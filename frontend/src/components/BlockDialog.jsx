import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Confirmación de bloqueo. Bloquear es una acción con consecuencias que no se
// ven en el momento (deja de aparecer en el feed, no puede escribirte ni
// llamarte, se corta el seguimiento), así que no se hace de un solo toque: se
// explica lo que va a pasar y se pide confirmación. Es reversible desde
// Ajustes, y el diálogo lo dice para que nadie tema que sea definitivo.
export default function BlockDialog({ person, onClose, onBlocked }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const targetId = person?.id || person?._id;
  const isSelf = user && String(user.id) === String(targetId);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function confirm() {
    if (!user) {
      setError('Inicia sesión para bloquear');
      return;
    }
    if (!targetId || isSelf) return;

    setBusy(true);
    setError('');
    try {
      await api.post(`/safety/block/${targetId}`);
      onBlocked?.(person);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!person) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Bloquear a @${person.username}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>¿Bloquear a @{person.username}?</h3>
        <p className="muted">
          No volverás a ver sus vídeos ni sus publicaciones, y no podrá escribirte ni
          llamarte. Tú tampoco verás sus contenidos. Puedes desbloquearlo cuando
          quieras desde Ajustes.
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-buttons">
          <button type="button" className="btn-primary danger" onClick={confirm} disabled={busy}>
            {busy ? 'Bloqueando…' : 'Bloquear'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
