import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Comments from './Comments';
import CreatorSheet from './CreatorSheet';
import ShareSheet from './ShareSheet';
import ReportDialog from './ReportDialog';
import BlockDialog from './BlockDialog';
import { readSoundOn, writeSoundOn, isMuted } from '../lib/sound';
import { downloadVideo } from '../lib/download';
import { attachVideoSource } from '../lib/video';

// One vertical, full-screen player. The feed is a snap-scroll column, so each
// card only plays while it is the visible one.
function VideoCard({ video, active, soundOn, onSoundBlocked, onLike, liked, onGift, onHideCreator, onHideTag, onComments, onOpenCreator, onShare }) {
  const videoRef = useRef(null);
  const startedAt = useRef(0);
  const reported = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    return attachVideoSource(el, video);
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
          {/* Avatar del creador con el botón "+" de seguir, como TikTok: es lo
              primero que identifica de quién es el vídeo. */}
          <div className="reel-avatar-wrap">
            <button
              type="button"
              className="reel-avatar"
              onClick={() => onOpenCreator(video.creator)}
              aria-label={`Ver perfil de @${video.creator?.username || 'creador'}`}
            >
              {video.creator?.profile?.avatar ? (
                <img src={video.creator.profile.avatar} alt="" />
              ) : (
                <span aria-hidden="true">{(video.creator?.username || '?').charAt(0).toUpperCase()}</span>
              )}
            </button>
            <button
              type="button"
              className="reel-follow"
              onClick={() => onOpenCreator(video.creator)}
              aria-label={`Seguir a @${video.creator?.username || 'creador'}`}
              title="Seguir"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
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
          {/* Disco de audio girando, la marca visual de TikTok. Solo gira
              cuando el vídeo está activo y el sonido está encendido. */}
          <div className={`reel-disc ${active && soundOn ? 'spin' : ''}`} aria-hidden="true">
            <span>♪</span>
          </div>
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

          {/* Compartir, con la flecha curva de TikTok. Abre la hoja con
              enviar/compartir/copiar enlace/descargar y, al final, las señales
              negativas que antes vivían en un menú de tres puntos aparte. */}
          <button
            type="button"
            className="reel-action"
            onClick={() => onShare(video)}
            aria-label="Compartir vídeo"
            title="Compartir"
          >
            <span aria-hidden="true">➦</span>
            <small>Compartir</small>
          </button>
        </div>
      </div>
    </section>
  );
}

export default function Feed({ onGiftRequest, onCall, onMessage, paused = false, focusVideoId = null }) {
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
  // Vídeo cuya hoja de compartir está abierta. Es una sola a la vez, así que
  // vive aquí y no en cada tarjeta.
  const [shareFor, setShareFor] = useState(null);
  // Seguridad: qué se está reportando y a quién se está bloqueando. Son dos
  // diálogos distintos y excluyentes, así que un estado cada uno.
  const [reportFor, setReportFor] = useState(null);
  const [blockFor, setBlockFor] = useState(null);
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

  // Enlace compartido (`/?video=<id>`): el vídeo del enlace se trae aparte y se
  // coloca el primero, para que el reel abierto sea el que se compartió. Se
  // pide al endpoint de un vídeo suelto y no al feed porque el feed va rankeado
  // y podría no incluirlo entre los primeros.
  //
  // Se guarda en su propio estado en vez de anteponerlo a `videos` al vuelo: la
  // carga del feed es asíncrona y puede llegar después y pisar la lista, así que
  // el reordenado se hace en un efecto aparte que se aplica también a cada
  // cambio de `videos`.
  const [focusVideo, setFocusVideo] = useState(null);
  // Si el vídeo del enlace ya se colocó delante. Se separa del efecto para que
  // "Cargar más" no vuelva a saltar al principio del feed.
  const focusPlaced = useRef(false);

  useEffect(() => {
    if (!focusVideoId) return undefined;
    let active = true;
    api
      .get(`/videos/${focusVideoId}`)
      .then(({ data }) => {
        if (active && data?.video) setFocusVideo(data.video);
      })
      // Un enlace roto o retirado no debe romper el feed: se ignora y se sigue
      // mostrando lo de siempre.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [focusVideoId]);

  useEffect(() => {
    if (!focusVideo) return;
    setVideos((prev) => {
      // Ya está delante: no se toca la lista (devolver `prev` evita el bucle,
      // porque el estado no cambia de identidad).
      if (prev[0]?._id === focusVideo._id) return prev;
      return [focusVideo, ...prev.filter((v) => v._id !== focusVideo._id)];
    });
    if (!focusPlaced.current) {
      focusPlaced.current = true;
      setActiveIndex(0);
      containerRef.current?.scrollTo({ top: 0 });
    }
  }, [focusVideo, videos]);

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

  // Descarga el vídeo que se está viendo, sea de quien sea. Se pide al servidor
  // el descriptor y se dispara la bajada; el contador sube al concederse, así
  // que se refleja aquí sin recargar el feed. Devuelve el descriptor para que
  // quien lo llamó (la hoja de compartir) pueda decir qué se bajó.
  async function handleDownload(video) {
    if (!user) {
      setError('Inicia sesión para descargar vídeos');
      return null;
    }
    try {
      const data = await downloadVideo(video._id);
      setVideos((prev) =>
        prev.map((v) =>
          v._id === video._id ? { ...v, downloads: (v.downloads || 0) + 1 } : v
        )
      );
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  // El aviso flotante no debe quedarse pegado: el error se retira solo. Sin
  // esto, un fallo puntual tapaba el vídeo hasta cambiar de pantalla.
  //
  // El error de carga del feed (lista vacía) se deja fuera: ese se pinta como
  // pantalla completa y borrarlo haría que un fallo real se confundiera con
  // "todavía no hay vídeos".
  useEffect(() => {
    if (!error || videos.length === 0) return undefined;
    const timer = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(timer);
  }, [error, videos.length]);

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

  // Al bloquear, los vídeos de esa persona desaparecen del feed en el acto. Se
  // hace en local y no se recarga: la lista entera saltaría de posición y el
  // usuario perdería el vídeo que estaba viendo.
  function blockCreator(creator) {
    if (!creator?._id) return;
    setVideos((prev) => prev.filter((v) => v.creator?._id !== creator._id));
  }

  // El contador de compartidos de la tarjeta sube con lo que responde el
  // servidor, no sumando uno a ciegas: si el servidor ya lo tenía contado (el
  // usuario ya había compartido ese vídeo antes), devuelve el mismo número y la
  // pantalla no miente.
  function adjustShareCount(video, shares) {
    if (!video?._id || typeof shares !== 'number') return;
    setVideos((prev) => prev.map((v) => (v._id === video._id ? { ...v, shares } : v)));
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

      {/* Aviso flotante de error (p. ej. descarga fallida). El error general
          solo se pinta cuando el feed está vacío, así que aquí hace falta uno
          propio para no dejar un fallo en silencio. */}
      {error && videos.length > 0 && (
        <div className="reel-toast error" role="status">
          {error}
        </div>
      )}

      <div className="reels" ref={containerRef} onScroll={handleScroll}>
        {videos.map((video, index) => (
          <VideoCard
            key={video._id}
            video={video}
            active={index === activeIndex && !paused}
            soundOn={soundOn}
            onSoundBlocked={() => setSoundBlocked(true)}
            liked={likedIds.includes(video._id)}
            onLike={like}
            onGift={onGiftRequest}
            onHideCreator={hideCreator}
            onHideTag={hideTag}
            onComments={setCommentsFor}
            onOpenCreator={setCreatorSheet}
            onShare={setShareFor}
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
            onReport={(creator) => {
              setCreatorSheet(null);
              setReportFor({ type: 'user', item: creator });
            }}
            onBlock={(creator) => {
              setCreatorSheet(null);
              setBlockFor(creator);
            }}
          />
        )}

        {/* Hoja de compartir: enviar, compartir, copiar enlace y descargar, más
            las señales negativas. Como el resto de hojas, vive dentro del feed
            para que el vídeo siga detrás y el scroll no se pierda. */}
        {shareFor && (
          <ShareSheet
            video={shareFor}
            onClose={() => setShareFor(null)}
            onDownload={handleDownload}
            onMessage={(creator) => {
              setShareFor(null);
              onMessage?.(creator);
            }}
            onHideCreator={hideCreator}
            onHideTag={hideTag}
            onReport={(video) => setReportFor({ type: 'video', item: video })}
            onBlock={(creator) => setBlockFor(creator)}
            onShared={adjustShareCount}
          />
        )}

        {/* Reportar un vídeo del feed. El diálogo es el mismo que usa Explorar,
            para que el motivo elegido sea idéntico venga de donde venga. */}
        {reportFor && (
          <ReportDialog
            targetType={reportFor.type}
            target={reportFor.item}
            onClose={() => setReportFor(null)}
          />
        )}

        {/* Bloquear desde el feed. Al confirmar, sus vídeos se van de la lista
            sin recargar. */}
        {blockFor && (
          <BlockDialog
            person={blockFor}
            onClose={() => setBlockFor(null)}
            onBlocked={blockCreator}
          />
        )}
      </div>
    </div>
  );
}
