import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Comments from './Comments';
import CreatorSheet from './CreatorSheet';
import { readSoundOn, writeSoundOn, isMuted } from '../lib/sound';

// One vertical, full-screen player. The feed is a snap-scroll column, so each
// card only plays while it is the visible one.
function VideoCard({ video, active, soundOn, onSoundBlocked, onLike, liked, onGift, onHideCreator, onHideTag, onComments, onOpenCreator }) {
  const videoRef = useRef(null);
  const startedAt = useRef(0);
  const reported = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;

    // Prefer the HLS ladder when the background transcode produced one; fall
    // back to the original file so a video is playable the moment it uploads.
    const source = video.hlsUrl || video.videoUrl;

    if (!source?.endsWith('.m3u8')) {
      el.src = source;
      return undefined;
    }

    let hls;
    let cancelled = false;

    // hls.js is ~500 kB, so it is fetched only when a video actually needs it
    // instead of weighing down the initial bundle.
    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: true });
          hls.loadSource(source);
          hls.attachMedia(el);
        } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari plays HLS natively.
          el.src = source;
        }
      })
      .catch(() => {
        // If the player cannot be loaded, the original file is still playable.
        el.src = video.videoUrl;
      });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [video.hlsUrl, video.videoUrl]);

  // Play only the visible card, and record how long it was watched when it
  // stops being the active one.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (active) {
      startedAt.current = Date.now();
      reported.current = false;
      // El sonido depende del botón del feed, no de cada tarjeta.
      el.muted = isMuted(true, soundOn);
      el.volume = 1;
      el.play().catch(() => {
        // El navegador bloquea el autoplay con sonido hasta que hay una
        // interacción. Si eso pasa, se reintenta en silencio para que el vídeo
        // no se quede congelado y se avisa para ofrecer el botón de sonido.
        if (soundOn) {
          el.muted = true;
          el.play().catch(() => {});
          onSoundBlocked?.();
        }
      });
      return;
    }

    el.pause();
    el.currentTime = 0;

    if (startedAt.current && !reported.current) {
      reported.current = true;
      const watchDuration = (Date.now() - startedAt.current) / 1000;
      // Best-effort retention signal; a failure must not break scrolling.
      api
        .post('/analytics/watch', {
          videoId: video._id,
          watchDuration,
          videoDuration: video.duration || undefined,
        })
        .catch(() => {});
    }
  }, [active, soundOn, video._id, video.duration]);

  // Si el usuario pidió sonido pero el navegador bloqueó el autoplay con audio,
  // hay que avisar: si no, el vídeo se vería mudo sin explicación. El primer
  // toque en cualquier parte de la tarjeta reanuda la reproducción con sonido.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active || !soundOn) return;

    function resumeWithSound() {
      el.muted = false;
      el.play().catch(() => {});
    }

    el.addEventListener('click', resumeWithSound);
    return () => el.removeEventListener('click', resumeWithSound);
  }, [active, soundOn]);

  return (
    <section className="reel" data-video-id={video._id}>
      <video
        ref={videoRef}
        className="reel-video"
        poster={video.thumbnailUrl}
        loop
        muted={isMuted(active, soundOn)}
        playsInline
        preload="metadata"
      />

      <div className="reel-overlay">
        <div className="reel-author">
          <button
            type="button"
            className="reel-author-name"
            onClick={() => onOpenCreator(video.creator)}
            aria-label={`Opciones de contacto con @${video.creator?.username || 'creador'}`}
          >
            @{video.creator?.username || 'desconocido'}
          </button>
          <p>{video.title}</p>
          {video.description && <small>{video.description}</small>}
          {video.tags?.length > 0 && (
            <div className="reel-tags">
              {video.tags.slice(0, 4).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="reel-tag"
                  onClick={() => onHideTag(tag)}
                  title={`No me interesa #${tag}`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
          {video.newsVerified && (
            <span className="news-badge" title="Verificado por un revisor de TAK TAK">
              ✓ Noticia verificada
            </span>
          )}
          {video.transcodeStatus === 'processing' && (
            <small className="reel-badge">Procesando calidad…</small>
          )}
        </div>

        <div className="reel-actions">
          <button
            type="button"
            className={`reel-action ${liked ? 'liked' : ''}`}
            onClick={() => onLike(video)}
            aria-pressed={liked}
          >
            <span aria-hidden="true">❤️</span>
            <small>{video.likes}</small>
          </button>
          <button type="button" className="reel-action" onClick={() => onComments(video)}>
            <span aria-hidden="true">💬</span>
            <small>{video.comments}</small>
          </button>
          <button type="button" className="reel-action" onClick={() => onGift(video)}>
            <span aria-hidden="true">🎁</span>
            <small>{video.gifts}</small>
          </button>
          <div className="reel-action" aria-hidden="true">
            <span>👁</span>
            <small>{video.views}</small>
          </div>

          {/* Negative signals. Without these the only way to stop seeing a
              topic is to stop opening the app. */}
          <button
            type="button"
            className="reel-action"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Más opciones"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="reel-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onHideTag(video.tags?.[0] ?? video.title);
            }}
          >
            🚫 No me interesa
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onHideCreator(video.creator);
            }}
          >
            🙈 Ocultar a @{video.creator?.username}
          </button>
          <button type="button" role="menuitem" onClick={() => setMenuOpen(false)}>
            ✖ Cerrar
          </button>
        </div>
      )}
    </section>
  );
}

export default function Feed({ onGiftRequest, onCall, onMessage }) {
  const { user } = useAuth();
  const [videos, setVideos] = useState([]);
  const [likedIds, setLikedIds] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [commentsFor, setCommentsFor] = useState(null);
  const [creatorSheet, setCreatorSheet] = useState(null);
  // Sonido del feed. Arranca silenciado (lo exige el autoplay del navegador) y
  // la elección se recuerda entre visitas.
  const [soundOn, setSoundOn] = useState(readSoundOn);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const containerRef = useRef(null);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      writeSoundOn(next);
      // Al activar el sonido a mano, el gesto cuenta como interacción: se
      // levanta el aviso de bloqueo.
      if (next) setSoundBlocked(false);
      return next;
    });
  }, []);

  const load = useCallback(async (nextCursor) => {
    setLoading(true);
    setError('');
    try {
      // The feed must come from the ranked endpoint, not the raw catalogue:
      // only `/feed/for-you` applies the recommendation model and the
      // "not interested" filters. Falling back to `/videos` would silently
      // ignore everything the viewer muted.
      const params = { limit: 10 };
      if (nextCursor) params.page = nextCursor;

      const { data } = await api.get('/feed/for-you', { params });
      // Un cuerpo JSON válido puede no traer `videos` (versión antigua del
      // backend, proxy que responde otra cosa). Sin este respaldo, `data.videos`
      // es `undefined` y el render revienta con un error incomprensible.
      const batch = Array.isArray(data?.videos) ? data.videos : [];
      setVideos((prev) => (nextCursor ? [...prev, ...batch] : batch));
      setCursor(batch.length === params.limit ? (Number(params.page) || 1) + 1 : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // Re-fetch when the viewer changes: the anonymous feed and the personalised
    // one are different queries, so logging in must not keep the old list.
  }, []);

  useEffect(() => {
    setVideos([]);
    setCursor(null);
    setActiveIndex(0);
    load();
  }, [load, user]);

  async function like(video) {
    if (!user) {
      setError('Inicia sesión para dar me gusta');
      return;
    }
    try {
      const { data } = await api.post(`/videos/${video._id}/like`);
      setVideos((prev) =>
        prev.map((v) => (v._id === video._id ? { ...v, likes: data.likes } : v))
      );
      setLikedIds((prev) =>
        data.liked ? [...prev, video._id] : prev.filter((id) => id !== video._id)
      );
    } catch (err) {
      setError(err.message);
    }
  }

  // Negative signals. The video is dropped locally right away so the feed feels
  // instant, and the server is told in the background.
  async function hideCreator(creator) {
    if (!user) {
      setError('Inicia sesión para personalizar tu feed');
      return;
    }
    if (!creator?._id) return;

    setVideos((prev) => prev.filter((v) => v.creator?._id !== creator._id));
    try {
      await api.post('/feed/hide-creator', { creatorId: creator._id });
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  async function hideTag(tag) {
    if (!user) {
      setError('Inicia sesión para personalizar tu feed');
      return;
    }
    if (!tag) return;

    setVideos((prev) => prev.filter((v) => !(v.tags ?? []).includes(tag)));
    try {
      await api.post('/feed/hide-tag', { tag });
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  // The card crossing the viewport midpoint becomes the active one.
  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    const index = Math.round(container.scrollTop / container.clientHeight);
    if (index !== activeIndex && index >= 0 && index < videos.length) {
      setActiveIndex(index);
    }
  }

  // The counter on the card must match the server after the panel changes the
  // thread. Adjusting it locally from the delta the panel reports avoids
  // refetching the whole feed for a single comment.
  function adjustCommentCount(videoId, delta) {
    setVideos((prev) =>
      prev.map((v) =>
        v._id === videoId ? { ...v, comments: Math.max(0, (v.comments || 0) + delta) } : v
      )
    );
  }

  if (loading && videos.length === 0) return <div className="centered">Cargando videos…</div>;
  if (error && videos.length === 0) return <div className="centered error">{error}</div>;
  if (videos.length === 0) {
    return (
      <div className="centered">
        Todavía no hay videos. ¡Sé el primero en subir uno!
      </div>
    );
  }

  return (
    <div className="reels-wrap">
      <button
        type="button"
        className={`reel-sound ${soundOn ? 'on' : 'off'}`}
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={soundOn ? 'Silenciar vídeo' : 'Activar sonido'}
        title={soundOn ? 'Silenciar' : 'Activar sonido'}
      >
        {soundOn ? '🔊' : '🔇'}
      </button>

      {soundBlocked && !soundOn && (
        <button type="button" className="reel-sound-hint" onClick={toggleSound}>
          🔇 Toca para activar el sonido
        </button>
      )}

      <div className="reels" ref={containerRef} onScroll={handleScroll}>
        {videos.map((video, index) => (
          <VideoCard
            key={video._id}
            video={video}
            active={index === activeIndex}
            soundOn={soundOn}
            onSoundBlocked={() => setSoundBlocked(true)}
            liked={likedIds.includes(video._id)}
            onLike={like}
            onGift={onGiftRequest}
            onHideCreator={hideCreator}
            onHideTag={hideTag}
            onComments={setCommentsFor}
            onOpenCreator={setCreatorSheet}
          />
        ))}

        {cursor && (
          <div className="reel-load">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => load(cursor)}
              disabled={loading}
            >
              {loading ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}

        {/* El panel vive dentro del feed para que el vídeo de detrás siga
            reproduciéndose y la posición del scroll no se pierda al cerrarlo. */}
        {commentsFor && (
          <Comments
            video={commentsFor}
            onClose={() => setCommentsFor(null)}
            onCountChange={(delta) => adjustCommentCount(commentsFor._id, delta)}
          />
        )}

        {/* Contactar con el creador sin salir del video: la acción contextual que
            pide la idea de WhaTaka. Al cerrar, el feed sigue donde estaba. */}
        {creatorSheet && (
          <CreatorSheet
            creator={creatorSheet}
            onClose={() => setCreatorSheet(null)}
            onMessage={(creator) => {
              setCreatorSheet(null);
              onMessage?.(creator);
            }}
            onCall={(creator, kind) => {
              setCreatorSheet(null);
              onCall?.(creator, kind);
            }}
          />
        )}
      </div>
    </div>
  );
}
