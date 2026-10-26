import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Motivos de reporte, con el texto que ve el usuario. El identificador es el
// mismo que valida el servidor; si divergieran, un motivo nuevo fallaría en el
// envío sin explicar por qué.
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam o engaño' },
  { id: 'harassment', label: 'Acoso o bullying' },
  { id: 'hate', label: 'Discurso de odio' },
  { id: 'violence', label: 'Violencia o peligro' },
  { id: 'nudity', label: 'Contenido sexual' },
  { id: 'misinformation', label: 'Información falsa' },
  { id: 'impersonation', label: 'Suplantación de identidad' },
  { id: 'self_harm', label: 'Autolesión o suicidio' },
  { id: 'other', label: 'Otro motivo' },
];

// Nombre legible de lo que se reporta, para el título del diálogo.
const TARGET_LABELS = {
  video: 'este vídeo',
  user: 'este perfil',
  post: 'esta publicación',
  comment: 'este comentario',
  post_comment: 'este comentario',
  message: 'este mensaje',
};

// Diálogo de reporte. Se abre desde cualquier contenido y desde el perfil.
//
// Además del reporte ofrece bloquear a la persona, porque son las dos salidas
// que se buscan juntas: quien reporta un acoso normalmente no quiere volver a
// ver a esa persona mientras la plataforma decide. Separarlos obligaría a
// cerrar el reporte y buscar el perfil solo para bloquear.
export default function ReportDialog({ targetType, target, onClose }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');

  // El usuario dueño del contenido: el creador del vídeo, el autor del
  // comentario o la propia persona. Es a quien se puede bloquear.
  const ownerId =
    targetType === 'user'
      ? target?.id || target?._id
      : target?.creator?.id ||
        target?.creator?._id ||
        target?.author?.id ||
        target?.author?._id ||
        target?.owner?.id ||
        null;
  const ownerName =
    target?.creator?.username || target?.author?.username || target?.username || target?.owner?.username;

  const isSelf = user && String(user.id) === String(ownerId);

  // Escape cierra, como el resto de paneles de la app.
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (!reason) {
      setError('Elige un motivo');
      return;
    }
    if (!user) {
      setError('Inicia sesión para reportar');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api.post('/safety/reports', {
        targetType,
        targetId: target?.id || target?._id,
        reason,
        details: details.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!ownerId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/safety/block/${ownerId}`);
      setBlocked(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Reportar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="report-head">
          <strong>⚑ Reportar {TARGET_LABELS[targetType] || 'contenido'}</strong>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✖
          </button>
        </div>

        {done ? (
          <div className="report-done">
            <p>Gracias. Revisaremos tu reporte y tomaremos medidas si corresponde.</p>
            {ownerId && !isSelf && (
              <button
                type="button"
                className="btn-secondary"
                onClick={block}
                disabled={busy || blocked}
              >
                {blocked
                  ? '🚫 Usuario bloqueado'
                  : `🚫 Bloquear a ${ownerName ? `@${ownerName}` : 'esta persona'}`}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <p className="muted report-help">
              Dinos qué pasa. Tu reporte es anónimo para la otra persona.
            </p>

            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <ul className="report-reasons">
              {REPORT_REASONS.map((r) => (
                <li key={r.id}>
                  <label className={`report-reason ${reason === r.id ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="report-reason"
                      value={r.id}
                      checked={reason === r.id}
                      onChange={() => setReason(r.id)}
                    />
                    <span>{r.label}</span>
                  </label>
                </li>
              ))}
            </ul>

            <textarea
              className="report-details"
              placeholder="Cuéntanos más (opcional)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              aria-label="Detalles del reporte"
            />

            <div className="report-actions">
              <button type="button" className="btn-primary" onClick={submit} disabled={busy || !reason}>
                {busy ? 'Enviando…' : 'Enviar reporte'}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancelar
              </button>
            </div>

            {ownerId && !isSelf && (
              <button
                type="button"
                className="btn-link danger report-block-link"
                onClick={block}
                disabled={busy}
              >
                {blocked ? '🚫 Bloqueado' : 'O bloquear a esta persona sin reportar'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
