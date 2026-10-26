import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { attachVideoSource } from '../lib/video';
import { formatCount } from '../lib/format';

// Rejilla de vídeos del perfil, como en TikTok: miniaturas verticales en tres
// columnas. Al tocar una se abre el vídeo a pantalla completa, en el mismo
// reproductor que el feed (no una página aparte), y se puede pasar de uno a otro
// deslizando. Sin miniatura se enseña el propio vídeo en silencio como cartel,
// para que una rejilla de vídeos recién subidos no salga vacía.
function VideoGrid({ videos, onOpen }) {
  return (
    <div className="profile-grid">
      {videos.map((v) => (
        <button
          key={v._id}
          type="button"
          className="profile-thumb"
          onClick={() => onOpen(v._id)}
          aria-label={`Ver "${v.title}"`}
        >
          {v.thumbnailUrl ? (
            <img src={v.thumbnailUrl} alt="" loading="lazy" />
          ) : (
            <video
              className="profile-thumb-fallback"
              src={v.hlsUrl || v.videoUrl}
              muted
              playsInline
              preload="metadata"
            />
          )}
          <span className="profile-thumb-views">▶ {formatCount(v.views)}</span>
          {v.transcodeStatus === 'processing' && (
            <span className="profile-thumb-state">⏳</span>
          )}
          {v.transcodeStatus === 'failed' && (
            <span className="profile-thumb-state">⚠️</span>
          )}
        </button>
      ))}
    </div>
  );
}

// Una diapositiva del reproductor. Solo la activa carga y reproduce el vídeo:
// las demás muestran su miniatura, para no descargar en vano el perfil entero.
function PlayerSlide({ video, active, onExport, onReprocess }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active) return undefined;
    const detach = attachVideoSource(el, video);
    el.play().catch(() => {});
    return detach;
  }, [active, video]);

  const needsOptimize = video.transcodeStatus === 'failed' || !video.hlsUrl;

  return (
    <section className="profile-player-slide" data-video-id={video._id}>
      <video
        ref={videoRef}
        className="profile-player-video"
        poster={video.thumbnailUrl}
        loop
        playsInline
        preload={active ? 'auto' : 'none'}
      />
      <div className="profile-player-meta">
        <strong>{video.title}</strong>
        <small>
          👁 {formatCount(video.views)} · ❤️ {formatCount(video.likes)}
          {video.transcodeStatus === 'processing' && ' · ⏳ Optimizando…'}
        </small>
        {/* Las acciones de mantenimiento viven aquí, con el vídeo delante, en
            vez de en una lista aparte: así se exporta o se reprocesa el vídeo
            que se está viendo, sin buscarlo en una fila. */}
        <div className="profile-player-actions">
          {needsOptimize && video.transcodeStatus !== 'processing' && (
            <button type="button" className="btn-ghost" onClick={() => onReprocess(video)}>
              🔄 Reprocesar
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => onExport(video)}>
            ⬇️ Exportar limpio
          </button>
        </div>
      </div>
    </section>
  );
}

// Reproductor a pantalla completa de un vídeo del perfil. Reutiliza el mismo
// patrón que el feed (HLS con reserva al original) y permite deslizar entre los
// vídeos del perfil, como la lista de TikTok.
function ProfilePlayer({ videos, startId, onClose, onExport, onReprocess }) {
  const [index, setIndex] = useState(() => {
    const i = videos.findIndex((v) => v._id === startId);
    return i < 0 ? 0 : i;
  });
  const [muted, setMuted] = useState(true);
  const containerRef = useRef(null);

  // El silencio se aplica a todos los vídeos del reproductor, no solo al activo,
  // porque al deslizar el que suena es otro. Se hace desde fuera con un query
  // porque cada diapositiva gestiona su propio elemento.
  useEffect(() => {
    containerRef.current
      ?.querySelectorAll('video')
      .forEach((el) => {
        el.muted = muted;
      });
  }, [muted, index]);

  // Al cambiar de vídeo con el deslizamiento, el índice se recalcula desde la
  // posición real del scroll (no se acumula), así que no se desincroniza.
  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    const next = Math.round(container.scrollTop / container.clientHeight);
    if (next !== index) setIndex(next);
  }

  return (
    <div className="profile-player" role="dialog" aria-modal="true" aria-label="Reproductor de vídeo">
      <button
        type="button"
        className="profile-player-close"
        onClick={onClose}
        aria-label="Cerrar el reproductor"
      >
        ✕
      </button>
      <button
        type="button"
        className="profile-player-sound"
        onClick={() => setMuted((m) => !m)}
        aria-pressed={!muted}
        aria-label={muted ? 'Activar sonido' : 'Silenciar vídeo'}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      <div className="profile-player-scroll" ref={containerRef} onScroll={handleScroll}>
        {videos.map((v, i) => (
          <PlayerSlide
            key={v._id}
            video={v}
            active={i === index}
            onExport={onExport}
            onReprocess={onReprocess}
          />
        ))}
      </div>
    </div>
  );
}

export default function Profile({ onNavigate }) {
  const { user, setUser } = useAuth();
  const [videos, setVideos] = useState([]);
  const [form, setForm] = useState({ displayName: '', bio: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Vídeo abierto a pantalla completa, o null si se está viendo la rejilla.
  const [playing, setPlaying] = useState(null);

  useEffect(() => {
    if (!user) return;
    setForm({
      displayName: user.profile?.displayName || '',
      bio: user.profile?.bio || '',
    });

    api
      .get(`/users/${user.username}`)
      .then(({ data }) => setVideos(Array.isArray(data?.videos) ? data.videos : []))
      .catch((err) => setError(err.message));
  }, [user]);

  async function save(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { data } = await api.patch('/users/me', form);
      setUser(data.user);
      setNotice('Perfil actualizado');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportVideo(video) {
    setError('');
    setNotice('');
    try {
      const { data } = await api.get(`/videos/${video._id}/export`);
      // Straight to the original file: no watermark, no re-encode.
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice(`Exportando "${data.filename}" sin marca de agua`);
    } catch (err) {
      setError(err.message);
    }
  }

  // Un vídeo sin HLS es un original que el navegador puede no reproducir (por
  // ejemplo, HEVC de iPhone). Reprocesar lanza la conversión otra vez y el vídeo
  // aparece como "optimizando" hasta que termina.
  function markProcessing(id) {
    setVideos((prev) =>
      prev.map((v) => (v._id === id ? { ...v, transcodeStatus: 'processing' } : v))
    );
  }

  function watchVideo(id, tries = 0) {
    if (tries >= 40) return;
    setTimeout(async () => {
      try {
        const { data } = await api.get(`/videos/${id}/status`);
        if (data.transcodeStatus === 'processing') {
          watchVideo(id, tries + 1);
          return;
        }
        setVideos((prev) =>
          prev.map((v) =>
            v._id === id
              ? { ...v, transcodeStatus: data.transcodeStatus, hlsUrl: data.hlsUrl }
              : v
          )
        );
        setNotice(
          data.transcodeStatus === 'ready'
            ? 'Vídeo optimizado. Ya se reproduce en todas partes.'
            : 'No se pudo optimizar el vídeo.'
        );
      } catch {
        // Silencioso: el usuario ya ve el estado en la lista.
      }
    }, 3000);
  }

  async function reprocessVideo(video) {
    setError('');
    setNotice('');
    markProcessing(video._id);
    try {
      await api.post(`/videos/${video._id}/retranscode`);
      setNotice(`Optimizando "${video.title}"…`);
      watchVideo(video._id);
    } catch (err) {
      setError(err.message);
      setVideos((prev) =>
        prev.map((v) => (v._id === video._id ? { ...v, transcodeStatus: 'failed' } : v))
      );
    }
  }

  if (!user) return null;

  return (
    <div className="profile">
      <div className="screen-head">
        <h2>@{user.username}</h2>
        <button
          type="button"
          className="btn-ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => onNavigate?.('settings')}
          aria-label="Configuración"
        >
          ⚙️
        </button>
      </div>

      <div className="wallet-stats">
        <div className="stat-card">
          <h3>Seguidores</h3>
          <span className="amount">{user.profile?.followers?.length ?? 0}</span>
        </div>
        <div className="stat-card">
          <h3>Siguiendo</h3>
          <span className="amount">{user.profile?.following?.length ?? 0}</span>
        </div>
        <div className="stat-card">
          <h3>Likes totales</h3>
          <span className="amount">{user.stats?.totalLikes ?? 0}</span>
        </div>
      </div>

      <form className="profile-form" onSubmit={save}>
        <h3>Editar perfil</h3>
        <input
          type="text"
          placeholder="Nombre visible"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          maxLength={50}
        />
        <textarea
          placeholder="Biografía"
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          maxLength={300}
          rows={3}
        />
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>

      <div className="profile-videos">
        <h3>Mis videos ({videos.length})</h3>
        {videos.length === 0 ? (
          <p>Todavía no has subido videos.</p>
        ) : (
          <VideoGrid videos={videos} onOpen={setPlaying} />
        )}
      </div>

      {playing && (
        <ProfilePlayer
          videos={videos}
          startId={playing}
          onClose={() => setPlaying(null)}
          onExport={exportVideo}
          onReprocess={reprocessVideo}
        />
      )}
    </div>
  );
}
