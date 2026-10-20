import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// One comment line. A deleted comment keeps its place in the thread so the
// replies below it do not appear to answer nothing, but it shows no text and
// no author.
function CommentRow({ comment, currentUser, onReply, onDelete, onLike }) {
  const isAuthor = currentUser && comment.author?._id === currentUser.id;
  const isAdmin = currentUser?.role === 'admin';

  if (comment.deleted) {
    return (
      <li className="comment comment-deleted">
        <p className="muted">Comentario eliminado</p>
      </li>
    );
  }

  return (
    <li className="comment">
      <div className="comment-head">
        <strong>@{comment.author?.username || 'desconocido'}</strong>
        <small>{new Date(comment.createdAt).toLocaleDateString()}</small>
      </div>
      <p className="comment-text">{comment.text}</p>
      <div className="comment-actions">
        <button
          type="button"
          className={`comment-like ${comment.liked ? 'liked' : ''}`}
          onClick={() => onLike(comment)}
          aria-label="Me gusta en el comentario"
        >
          ❤️ {comment.likes}
        </button>
        <button type="button" className="btn-ghost" onClick={() => onReply(comment)}>
          Responder
        </button>
        {(isAuthor || isAdmin) && (
          <button type="button" className="btn-ghost" onClick={() => onDelete(comment)}>
            Eliminar
          </button>
        )}
      </div>
      {comment.replies?.length > 0 && (
        <ul className="comment-replies">
          {comment.replies.map((reply) => (
            <CommentRow
              key={reply._id}
              comment={reply}
              currentUser={currentUser}
              onReply={onReply}
              onDelete={onDelete}
              onLike={onLike}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Comments({ video, onClose, onCountChange }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  // The panel covers the video but must not stop it: the thread is about what
  // is playing behind it. `position: fixed` keeps it above the reel without
  // unmounting the player, so playback continues and resumes exactly where it
  // was.
  const load = useCallback(
    async (nextCursor) => {
      setLoading(true);
      try {
        const params = nextCursor ? { cursor: nextCursor } : {};
        const { data } = await api.get(`/comments/video/${video._id}`, { params });
        const batch = Array.isArray(data?.comments) ? data.comments : [];
        setComments((prev) => (nextCursor ? [...prev, ...batch] : batch));
        setCursor(data?.nextCursor || null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [video._id]
  );

  useEffect(() => {
    setComments([]);
    setCursor(null);
    setError('');
    load();
  }, [load]);

  // Escape closes the panel, and focus starts in the field so a comment can be
  // typed without an extra tap.
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    const clean = text.trim();
    if (!clean) return;

    setSending(true);
    setError('');
    try {
      const body = { text: clean };
      if (replyTo) body.parentId = replyTo._id;
      const { data } = await api.post(`/comments/video/${video._id}`, body);

      if (replyTo) {
        // Attach the new reply under its parent without refetching the page.
        setComments((prev) =>
          prev.map((c) =>
            c._id === replyTo._id
              ? { ...c, replies: [...(c.replies || []), data.comment] }
              : c
          )
        );
      } else {
        setComments((prev) => [data.comment, ...prev]);
        // Only a top-level comment moves the video counter, matching the server.
        onCountChange?.(1);
      }
      setText('');
      setReplyTo(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function remove(comment) {
    setError('');
    try {
      await api.delete(`/comments/${comment._id}`);
      // The server keeps the row as a tombstone, so the local list mirrors it
      // rather than dropping the entry and renumbering the thread.
      setComments((prev) =>
        prev.map((c) =>
          c._id === comment._id
            ? { ...c, deleted: true, text: '', author: null }
            : {
                ...c,
                replies: (c.replies || []).map((r) =>
                  r._id === comment._id ? { ...r, deleted: true, text: '', author: null } : r
                ),
              }
        )
      );
      if (!comment.parent) onCountChange?.(-1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function like(comment) {
    if (!user) {
      setError('Inicia sesión para dar me gusta');
      return;
    }
    try {
      const { data } = await api.post(`/comments/${comment._id}/like`);
      const patch = (c) =>
        c._id === comment._id
          ? { ...c, likes: data.likes, liked: data.liked }
          : { ...c, replies: (c.replies || []).map(patch) };
      setComments((prev) => prev.map(patch));
    } catch (err) {
      setError(err.message);
    }
  }

  function startReply(comment) {
    setReplyTo(comment);
    inputRef.current?.focus();
  }

  return (
    <div className="comments-panel" role="dialog" aria-modal="true" aria-label="Comentarios">
      <div className="comments-head">
        <h3>Comentarios</h3>
        <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar comentarios">
          ✖
        </button>
      </div>

      <div className="comments-body">
        {loading && comments.length === 0 && <p className="muted">Cargando comentarios…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!loading && comments.length === 0 && (
          <p className="muted">Todavía no hay comentarios. Sé el primero.</p>
        )}

        <ul className="comments-list">
          {comments.map((comment) => (
            <CommentRow
              key={comment._id}
              comment={comment}
              currentUser={user}
              onReply={startReply}
              onDelete={remove}
              onLike={like}
            />
          ))}
        </ul>

        {cursor && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => load(cursor)}
            disabled={loading}
          >
            {loading ? 'Cargando…' : 'Ver más comentarios'}
          </button>
        )}
      </div>

      {user ? (
        <form className="comments-form" onSubmit={submit}>
          {replyTo && (
            <div className="comment-replying">
              Respondiendo a @{replyTo.author?.username}
              <button type="button" className="btn-ghost" onClick={() => setReplyTo(null)}>
                Cancelar
              </button>
            </div>
          )}
          <div className="comments-input-row">
            <input
              ref={inputRef}
              type="text"
              placeholder={replyTo ? 'Escribe una respuesta…' : 'Añade un comentario…'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              aria-label="Escribe un comentario"
            />
            <button type="submit" className="btn-primary" disabled={sending || !text.trim()}>
              {sending ? '…' : 'Enviar'}
            </button>
          </div>
        </form>
      ) : (
        <p className="comments-signin muted">Inicia sesión para comentar.</p>
      )}
    </div>
  );
}
