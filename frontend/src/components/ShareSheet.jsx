import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { videoShareUrl, shareMessage, copyToClipboard, shareWithSystem } from '../lib/share';

// Hoja de compartir de un vídeo, al estilo TikTok: la flecha curva de la barra
// lateral abre este panel con las salidas habituales (enviar a un amigo,
// compartir con el sistema, copiar el enlace, descargar) y, al final, las
// señales negativas que antes vivían en su propio menú de tres puntos.
//
// Se mantiene como acción contextual: el vídeo sigue detrás y al cerrar se
// vuelve exactamente donde estaba.
export default function ShareSheet({ video, onClose, onDownload, onMessage, onHideCreator, onHideTag, onReport, onBlock, onShared }) {
  const { user } = useAuth();
  const [friends, setFriends] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const isSelf = user && (user.id === video?.creator?._id || user.username === video?.creator?.username);
  const link = videoShareUrl(video?._id);
  const author = video?.creator?.username ? `@${video.creator.username}` : 'este creador';

  // Contactos recientes para "Enviar a". Se reutiliza la bandeja de WhaTaka:
  // es la lista de personas con las que ya se habla, que es justo a quien se
  // manda un vídeo. Si falla, la hoja sigue siendo útil sin esa fila.
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    api
      .get('/messages/conversations')
      .then(({ data }) => {
        if (!active) return;
        const list = (Array.isArray(data?.conversations) ? data.conversations : [])
          .map((c) => c.with?.[0])
          .filter((p) => p && String(p.id) !== String(user.id));
        setFriends(list.slice(0, 12));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  // Escape cierra, como el resto de paneles de la app.
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Aviso breve dentro de la hoja; se retira solo.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  function requireSession() {
    if (user) return true;
    setNotice('Inicia sesión para compartir');
    return false;
  }

  // El contador de compartidos del vídeo. Antes `shares` existía en el modelo y
  // el ranking le daba el mayor de sus pesos, pero **nada lo incrementaba**:
  // siempre marcaba 0. Se avisa al servidor una sola vez por apertura de la
  // hoja, no en cada acción, para no contar como tres compartidos un mismo
  // gesto que pasa por copiar y enviar. El servidor además es idempotente por
  // persona, así que reabrir la hoja tampoco infla el número.
  const counted = useRef(false);
  function recordShare() {
    if (!user || counted.current) return;
    counted.current = true;
    api
      .post(`/videos/${video?._id}/share`)
      .then(({ data }) => onShared?.(video, data.shares))
      .catch(() => {});
  }

  async function copyLink() {
    const ok = await copyToClipboard(link);
    if (ok) recordShare();
    setNotice(ok ? 'Enlace copiado' : 'No se pudo copiar el enlace');
  }

  async function systemShare() {
    const ok = await shareWithSystem(video);
    // Sin Web Share API (escritorio, HTTP) se cae a copiar, que es lo que la
    // persona quería: llevarse el enlace.
    if (!ok) await copyLink();
    else recordShare();
  }

  // Enviar el vídeo por WhaTaka: se abre (o crea) el hilo con esa persona y se
  // publica el enlace con su texto. Es lo que hace "Enviar a un amigo".
  async function sendTo(friend) {
    if (!requireSession()) return;
    setBusy(true);
    try {
      const { data } = await api.post('/messages/conversations', { userId: friend.id });
      await api.post(`/messages/conversations/${data.conversationId}/messages`, {
        text: shareMessage(video),
      });
      setNotice(`Enviado a @${friend.username}`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!requireSession()) return;
    setDownloading(true);
    try {
      const data = await onDownload?.(video);
      setNotice(data?.filename ? `Descargando "${data.filename}"` : 'Descarga iniciada');
    } finally {
      setDownloading(false);
    }
  }

  if (!video) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Compartir vídeo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share-sheet-head">
          <strong>Compartir</strong>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✖
          </button>
        </div>

        <div className="share-grid">
          <button type="button" className="share-option" onClick={systemShare}>
            <span className="share-icon" aria-hidden="true">🔗</span>
            <small>Compartir</small>
          </button>
          <button type="button" className="share-option" onClick={copyLink}>
            <span className="share-icon" aria-hidden="true">📋</span>
            <small>Copiar enlace</small>
          </button>
          <button
            type="button"
            className="share-option"
            onClick={download}
            disabled={downloading}
          >
            <span className="share-icon" aria-hidden="true">{downloading ? '⏳' : '⬇️'}</span>
            <small>Descargar</small>
          </button>
          <button
            type="button"
            className="share-option"
            onClick={() => {
              onClose();
              onMessage?.(video.creator);
            }}
            disabled={isSelf}
          >
            <span className="share-icon" aria-hidden="true">💬</span>
            <small>Mensaje</small>
          </button>
        </div>

        {user && friends.length > 0 && (
          <>
            <p className="share-subtitle">Enviar a</p>
            <div className="share-friends">
              {friends.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  className="share-friend"
                  onClick={() => sendTo(friend)}
                  disabled={busy}
                >
                  <span className="avatar">{(friend.username || '?').slice(0, 2).toUpperCase()}</span>
                  <small>@{friend.username}</small>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="share-rows">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onHideTag?.(video.tags?.[0] ?? video.title);
            }}
          >
            🚫 No me interesa
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onHideCreator?.(video.creator);
            }}
          >
            🙈 Ocultar a {author}
          </button>
          {/* Reportar y bloquear viven aquí, junto a las otras señales, porque es
              donde el usuario los busca: en el menú del vídeo que está viendo.
              Antes no existían en ninguna parte. */}
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onClose();
              onReport?.(video);
            }}
          >
            ⚑ Reportar vídeo
          </button>
          {!isSelf && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                onClose();
                onBlock?.(video.creator);
              }}
            >
              🚫 Bloquear a {author}
            </button>
          )}
        </div>

        {notice && (
          <p className="share-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
