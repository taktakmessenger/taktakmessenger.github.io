import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

function initials(person) {
  const name = person?.displayName || person?.username || '?';
  return name.slice(0, 2).toUpperCase();
}

function Avatar({ user, size = 40 }) {
  const src = user?.avatar;
  return (
    <span className="wall-avatar" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : initials(user)}
    </span>
  );
}

function relativeTime(value) {
  const date = new Date(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return date.toLocaleDateString();
}

// La caja de publicar: texto y/o una foto o un vídeo. El archivo se sube al
// elegirlo, igual que en el chat, para que publicar no dependa de una subida
// lenta y se pueda ver la vista previa antes.
function Composer({ onPublished }) {
  const fileInputRef = useRef(null);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function pickFile(event) {
    const file = event.target.files?.[0];
    // Se limpia el input para poder elegir el mismo archivo otra vez.
    event.target.value = '';
    if (!file) return;

    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/posts/attachments', form);
      setAttachment(data.attachment);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const body = text.trim();
    if (!body && !attachment) return;

    setError('');
    setSending(true);
    try {
      const { data } = await api.post('/posts', { text: body, attachment });
      setText('');
      setAttachment(null);
      onPublished(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="wall-composer" onSubmit={submit}>
      <textarea
        className="wall-composer-input"
        placeholder="¿Qué estás pensando?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
        aria-label="Texto de la publicación"
      />

      {attachment && (
        <div className="wall-composer-preview">
          {attachment.kind === 'image' ? (
            <img src={attachment.url} alt={attachment.name} />
          ) : (
            <video src={attachment.url} controls preload="metadata" />
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setAttachment(null)}
            aria-label="Quitar adjunto"
          >
            ✕
          </button>
        </div>
      )}

      {error && <p className="wall-error">{error}</p>}

      <div className="wall-composer-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={pickFile}
          hidden
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Subiendo…' : '📷 Foto o vídeo'}
        </button>
        <button type="submit" className="btn-primary" disabled={sending || uploading}>
          {sending ? 'Publicando…' : 'Publicar'}
        </button>
      </div>
    </form>
  );
}

// El hilo de comentarios de una publicación. Se carga solo al abrirlo, para no
// pedir los comentarios de todas las tarjetas de Facetak de golpe.
function PostComments({ postId, currentUser, onCountChange }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/posts/${postId}/comments`);
      setComments(data.comments);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError('');
    try {
      const { data } = await api.post(`/posts/${postId}/comments`, { text: body });
      setComments((prev) => [data, ...prev]);
      setText('');
      onCountChange(1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(comment) {
    setError('');
    try {
      await api.delete(`/posts/comments/${comment._id}`);
      setComments((prev) => prev.filter((c) => c._id !== comment._id));
      onCountChange(-1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function like(comment) {
    try {
      const { data } = await api.post(`/posts/comments/${comment._id}/like`);
      setComments((prev) =>
        prev.map((c) => (c._id === comment._id ? { ...c, likes: data.likes, liked: data.liked } : c))
      );
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="wall-comments">
      <form className="wall-comment-form" onSubmit={submit}>
        <input
          type="text"
          placeholder="Escribe un comentario…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          aria-label="Comentario"
        />
        <button type="submit" className="btn-primary" disabled={!text.trim()}>
          Enviar
        </button>
      </form>

      {error && <p className="wall-error">{error}</p>}
      {loading ? (
        <p className="muted">Cargando comentarios…</p>
      ) : comments.length === 0 ? (
        <p className="muted">Todavía no hay comentarios.</p>
      ) : (
        <ul className="wall-comment-list">
          {comments.map((comment) => {
            const isAuthor = currentUser && comment.author?._id === (currentUser.id || currentUser._id);
            const canDelete = isAuthor || currentUser?.role === 'admin';
            return (
              <li key={comment._id} className="wall-comment">
                <Avatar user={comment.author} size={32} />
                <div className="wall-comment-body">
                  <strong>@{comment.author?.username || 'desconocido'}</strong>
                  <p>{comment.text}</p>
                  <div className="wall-comment-actions">
                    <button
                      type="button"
                      className={`comment-like ${comment.liked ? 'liked' : ''}`}
                      onClick={() => like(comment)}
                      aria-label="Me gusta en el comentario"
                    >
                      ❤️ {comment.likes}
                    </button>
                    {canDelete && (
                      <button type="button" className="btn-ghost" onClick={() => remove(comment)}>
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PostCard({ post, currentUser, onOpenProfile }) {
  const [likes, setLikes] = useState(post.likes);
  const [liked, setLiked] = useState(post.liked);
  const [commentCount, setCommentCount] = useState(post.comments);
  const [showComments, setShowComments] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');

  const isAuthor = currentUser && post.author?._id === (currentUser.id || currentUser._id);
  const canDelete = isAuthor || currentUser?.role === 'admin';

  async function toggleLike() {
    if (!currentUser) return;
    setError('');
    try {
      const { data } = await api.post(`/posts/${post._id}/like`);
      setLikes(data.likes);
      setLiked(data.liked);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    setError('');
    try {
      await api.delete(`/posts/${post._id}`);
      setRemoved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (removed) return null;

  return (
    <article className="wall-post">
      <header className="wall-post-head">
        <button
          type="button"
          className="wall-post-author"
          onClick={() => onOpenProfile?.(post.author?._id)}
        >
          <Avatar user={post.author} />
          <span>
            <strong>
              {post.author?.displayName || `@${post.author?.username}`}
              {post.author?.isVerified ? ' ✅' : ''}
            </strong>
            <small>@{post.author?.username} · {relativeTime(post.createdAt)}</small>
          </span>
        </button>
        {canDelete && (
          <button type="button" className="btn-ghost" onClick={remove} aria-label="Eliminar publicación">
            ⋯
          </button>
        )}
      </header>

      {post.text && <p className="wall-post-text">{post.text}</p>}

      {post.attachment?.kind === 'image' && (
        <img className="wall-post-media" src={post.attachment.url} alt={post.attachment.name} loading="lazy" />
      )}
      {post.attachment?.kind === 'video' && (
        <video className="wall-post-media" src={post.attachment.url} controls preload="metadata" />
      )}

      {error && <p className="wall-error">{error}</p>}

      <footer className="wall-post-actions">
        <button
          type="button"
          className={`wall-action ${liked ? 'liked' : ''}`}
          onClick={toggleLike}
          disabled={!currentUser}
        >
          ❤️ {likes}
        </button>
        <button type="button" className="wall-action" onClick={() => setShowComments((v) => !v)}>
          💬 {commentCount}
        </button>
      </footer>

      {showComments && (
        <PostComments
          postId={post._id}
          currentUser={currentUser}
          onCountChange={(delta) => setCommentCount((c) => Math.max(0, c + delta))}
        />
      )}
    </article>
  );
}

// Facetak: la sección estilo Facebook de TAK TAK. Muestra las publicaciones de
// todo el mundo, con caja de publicar, me gusta y comentarios.
//
// `embedded` es cuando se pinta dentro de Inicio, en la pestaña Publicaciones:
// ahí manda el selector de Inicio y la cabecera grande sobra.
export default function Wall({ onOpenProfile, embedded = false }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/posts');
      setPosts(data.posts);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const { data } = await api.get(`/posts?cursor=${encodeURIComponent(cursor)}`);
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className={`wall ${embedded ? 'wall-embedded' : ''}`}>
      {!embedded && (
        <header className="wall-header">
          <h1>Facetak</h1>
          <p className="muted">Lo que comparte la comunidad TAK TAK</p>
        </header>
      )}

      {user ? (
        <Composer onPublished={(post) => setPosts((prev) => [post, ...prev])} />
      ) : (
        <p className="wall-login-hint muted">Entra en tu cuenta para publicar, dar me gusta y comentar.</p>
      )}

      {error && <p className="wall-error">{error}</p>}

      {loading ? (
        <p className="muted">Cargando Facetak…</p>
      ) : posts.length === 0 ? (
        <p className="muted">Todavía no hay publicaciones. Sé el primero.</p>
      ) : (
        <div className="wall-feed">
          {posts.map((post) => (
            <PostCard key={post._id} post={post} currentUser={user} onOpenProfile={onOpenProfile} />
          ))}
        </div>
      )}

      {cursor && (
        <button type="button" className="btn-secondary wall-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </div>
  );
}
