import { useEffect, useState } from 'react';
import api from '../api/client';

// Editar los datos de un vídeo ya publicado. Solo el título, la descripción y
// las etiquetas: el archivo no se reemplaza, porque cambiar el vídeo de un post
// que ya tiene vistas y comentarios cambiaría lo que la gente vio.
//
// Se abre desde la hoja de Compartir del propio vídeo, así que el vídeo sigue
// detrás y al guardar o cerrar se vuelve donde estaba.
export default function EditVideoDialog({ video, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', description: '', tags: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!video) return;
    setForm({
      title: video.title || '',
      description: video.description || '',
      tags: Array.isArray(video.tags) ? video.tags.join(', ') : '',
    });
  }, [video]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!video) return null;

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('El título no puede quedar vacío');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);
      const { data } = await api.patch(`/videos/${video._id}`, {
        title: form.title.trim(),
        description: form.description.trim(),
        tags,
      });
      onSaved?.(data.video);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Editar vídeo"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Editar vídeo</h3>
        <form className="edit-video-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Título"
            value={form.title}
            onChange={update('title')}
            maxLength={100}
            aria-label="Título"
          />
          <textarea
            placeholder="Descripción"
            value={form.description}
            onChange={update('description')}
            maxLength={500}
            rows={3}
            aria-label="Descripción"
          />
          <input
            type="text"
            placeholder="Etiquetas separadas por comas"
            value={form.tags}
            onChange={update('tags')}
            aria-label="Etiquetas"
          />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="report-actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
