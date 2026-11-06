import { useEffect, useState } from 'react';

// Confirmación genérica para acciones que no se deshacen. Se usa, por ahora,
// para eliminar un vídeo: es irreversible (se borra el vídeo y su hilo de
// comentarios) y por eso no se hace de un solo toque.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  error = '',
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {message && <p className="muted">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="report-actions">
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Un momento…' : confirmLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
