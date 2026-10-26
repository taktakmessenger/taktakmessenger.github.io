import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { attachVideoSource } from '../lib/video';
import { formatCount } from '../lib/format';
import ReportDialog from './ReportDialog';
import BlockDialog from './BlockDialog';

// Perfil público de otra persona. Faltaba por completo: desde Explorar se
// encuentra a alguien y no había dónde mirar quién es, qué ha publicado ni cómo
// contactarle. Reutiliza el endpoint público `/users/:username`, que ya existía
// para las hojas de contacto del feed.
//
// No tiene edición ni ajustes: es la cara que se enseña, no la propia.
function Grid({ videos, onOpen }) {
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
        </button>
      ))}
    </div>
  );
}

// Reproductor a pantalla completa de un vídeo del perfil ajeno. Es el mismo
// patrón que el propio (HLS con reserva al original, deslizar entre vídeos),
// pero sin las acciones de mantenimiento, que solo son del dueño.
function Player({ videos, startId, onClose }) {
  const [index, setIndex] = useState(() => {
    const i = videos.findIndex((v) => v._id === startId);
    return i < 0 ? 0 : i;
  });
  const containerRef = useRef(null);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    const i = Math.round(container.scrollTop / container.clientHeight);
    if (i >= 0 && i < videos.length && i !== index) setIndex(i);
  }

  return (
    <div className="profile-player">
      <button type="button" className="profile-player-close" onClick={onClose} aria-label="Cerrar">
        ✖
      </button>
      <div className="profile-player-scroll" ref={containerRef} onScroll={handleScroll}>
        {videos.map((v, i) => (
          <Slide key={v._id} video={v} active={i === index} />
        ))}
      </div>
    </div>
  );
}

function Slide({ video, active }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active) return undefined;
    const detach = attachVideoSource(el, video);
    el.play().catch(() => {});
    return detach;
  }, [active, video]);

  return (
    <section className="profile-player-slide" data-video-id={video._id}>
      <video
        ref={videoRef}
        className="profile-player-video"
        poster={video.thumbnailUrl}
        loop
        playsInline
        muted
        preload={active ? 'auto' : 'none'}
      />
      <div className="profile-player-meta">
        <strong>{video.title}</strong>
        <small>
          👁 {formatCount(video.views)} · ❤️ {formatCount(video.likes)}
        </small>
      </div>
    </section>
  );
}

export default function PublicProfile({ username, onBack, onMessage, onCall }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(null);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [block, setBlock] = useState(false);

  useEffect(() => {
    if (!username) return undefined;
    let active = true;
    setLoading(true);
    setError('');

    api
      .get(`/users/${encodeURIComponent(username)}`)
      .then(({ data }) => {
        if (!active) return;
        setProfile(data.user);
        setVideos(Array.isArray(data.videos) ? data.videos : []);
        const followers = (data.user?.profile?.followers || []).map(String);
        setFollowing(user ? followers.includes(String(user.id)) : false);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [username, user]);

  async function toggleFollow() {
    if (!user) {
      setError('Inicia sesión para seguir a este creador');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (following) {
        await api.delete(`/users/${username}/follow`);
        setFollowing(false);
      } else {
        await api.post(`/users/${username}/follow`);
        setFollowing(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isSelf = user && user.username === username;
  const person = profile
    ? { id: profile._id, username: profile.username, displayName: profile.profile?.displayName }
    : null;

  return (
    <div className="profile">
      <div className="screen-head">
        <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h2>@{username}</h2>
      </div>

      {loading && <p className="muted">Cargando…</p>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {profile && (
        <>
          <div className="public-profile-head">
            <span className="avatar big">{(profile.username || '?').slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{profile.profile?.displayName || `@${profile.username}`}</strong>
              {profile.profile?.bio && <p className="muted">{profile.profile.bio}</p>}
            </div>
          </div>

          <div className="wallet-stats">
            <div className="stat-card">
              <h3>Seguidores</h3>
              <span className="amount">{formatCount(profile.profile?.followers?.length ?? 0)}</span>
            </div>
            <div className="stat-card">
              <h3>Siguiendo</h3>
              <span className="amount">{formatCount(profile.profile?.following?.length ?? 0)}</span>
            </div>
            <div className="stat-card">
              <h3>Likes totales</h3>
              <span className="amount">{formatCount(profile.stats?.totalLikes ?? 0)}</span>
            </div>
          </div>

          {!isSelf && (
            <div className="public-profile-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={toggleFollow}
                disabled={busy}
              >
                {following ? 'Dejar de seguir' : 'Seguir'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => onMessage?.(person)}>
                💬 Mensaje
              </button>
              <button type="button" className="btn-secondary" onClick={() => onCall?.(person, 'audio')}>
                📞 Llamar
              </button>
            </div>
          )}

          <div className="profile-videos">
            <h3>Vídeos ({videos.length})</h3>
            {videos.length === 0 ? (
              <p className="muted">Esta persona todavía no ha publicado vídeos.</p>
            ) : (
              <Grid videos={videos} onOpen={setPlaying} />
            )}
          </div>

          {!isSelf && (
            <div className="public-profile-safety">
              <button type="button" className="btn-link danger" onClick={() => setReport(true)}>
                ⚑ Reportar perfil
              </button>
              <button type="button" className="btn-link danger" onClick={() => setBlock(true)}>
                🚫 Bloquear
              </button>
            </div>
          )}
        </>
      )}

      {playing && (
        <Player videos={videos} startId={playing} onClose={() => setPlaying(null)} />
      )}

      {report && profile && (
        <ReportDialog
          targetType="user"
          target={profile}
          onClose={() => setReport(false)}
        />
      )}

      {block && person && (
        <BlockDialog
          person={person}
          onClose={() => setBlock(false)}
          onBlocked={() => onBack?.()}
        />
      )}
    </div>
  );
}
