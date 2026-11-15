import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { formatCount } from '../lib/format';
import ReportDialog from './ReportDialog';

// Explorar: buscar personas, vídeos y etiquetas en una sola pantalla.
//
// Antes no existía. Al feed solo se llegaba deslizando, así que no había forma
// de encontrar a alguien concreto por su nombre, ni de volver a un vídeo que se
// recordaba. Es lo primero que se echa en falta en cuanto la app tiene contenido.

// Un vídeo de los resultados. Se reproduce al tocarlo, no al pintarlo: veinte
// vídeos en una lista descargando a la vez arruinarían la pantalla y los datos.
function VideoResult({ video, onOpen, onReport }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);

  function toggle() {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.play().catch(() => {});
  }

  return (
    <li className="search-video">
      <button type="button" className="search-video-thumb" onClick={toggle} aria-label={`Reproducir "${video.title}"`}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <video ref={videoRef} src={video.videoUrl} muted playsInline preload="metadata" />
        )}
        {playing && <span className="search-video-pause">❚❚</span>}
      </button>
      <div className="search-video-body">
        <button type="button" className="btn-link search-video-title" onClick={() => onOpen(video)}>
          {video.title}
        </button>
        <small className="muted">
          @{video.creator?.username || 'desconocido'} · 👁 {formatCount(video.views)} · ❤️{' '}
          {formatCount(video.likes)}
        </small>
        <div className="search-video-actions">
          <button type="button" className="btn-ghost" onClick={() => onOpen(video)}>
            Ver en el feed
          </button>
          <button
            type="button"
            className="btn-ghost danger"
            onClick={() => onReport('video', video)}
            aria-label={`Reportar "${video.title}"`}
          >
            ⚑ Reportar
          </button>
        </div>
      </div>
    </li>
  );
}

// Una persona en los resultados. Muestra lo que hace falta para decidir si es
// quien se busca: nombre, usuario, si es creador y cuánta gente la sigue.
function UserResult({ user, onOpen, onReport }) {
  return (
    <li className="search-user">
      <button type="button" className="search-user-main" onClick={() => onOpen(user)}>
        <span className="avatar">{(user.username || '?').slice(0, 2).toUpperCase()}</span>
        <span className="search-user-id">
          <strong>
            {user.displayName || `@${user.username}`}
            {user.isVerified && <span title="Verificado"> ✓</span>}
          </strong>
          <small className="muted">
            @{user.username}
            {user.isCreator ? ' · Creador' : ''} · {formatCount(user.followers)} seguidores
          </small>
        </span>
      </button>
      <button
        type="button"
        className="btn-ghost danger"
        onClick={() => onReport('user', user)}
        aria-label={`Reportar a @${user.username}`}
      >
        ⚑
      </button>
    </li>
  );
}

export default function Explore({ onOpenProfile, onOpenVideo, onOpenTag, onBack, initialQuery = '' }) {
  const { user } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState({ users: [], videos: [], tags: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  // Reporte en curso: { type, item }. La lista de motivos vive en el diálogo.
  const [report, setReport] = useState(null);
  // Resultados de fuera de TAK TAK (música y vídeo con licencia libre). Se piden
  // solo al abrir su pestaña: buscar siempre en internet duplicaría peticiones
  // para quien solo quiere encontrar a una persona.
  const [external, setExternal] = useState({ music: [], videos: [] });
  const [extLoading, setExtLoading] = useState(false);
  // Id del resultado que se está trayendo, para bloquear su botón mientras dura.
  const [importing, setImporting] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);
  // Cada búsqueda lleva su número. Solo se pinta la respuesta de la última
  // lanzada: sin esto, teclear rápido hace que una respuesta lenta de "ca"
  // llegue después de la de "casa" y la pise.
  const seqRef = useRef(0);

  // Al pulsar una etiqueta desde la propia pantalla de Explorar, la vista no se
  // remonta y el `useState` inicial no se vuelve a leer. Este efecto sí recoge el
  // término nuevo, para que "#viajes" busque de verdad al pulsarlo.
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  // La búsqueda se dispara con un pequeño retardo desde que se deja de teclear.
  // Buscar en cada pulsación multiplica las peticiones sin mejorar el resultado:
  // nadie lee la lista entre dos letras.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults({ users: [], videos: [], tags: [] });
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const { data } = await api.get('/search', { params: { q: term } });
        if (seq !== seqRef.current) return;
        setResults({
          users: data.users || [],
          videos: data.videos || [],
          tags: data.tags || [],
        });
        setError('');
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err.message);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const total = results.users.length + results.videos.length + results.tags.length;
  const showUsers = tab === 'all' || tab === 'users';
  const showVideos = tab === 'all' || tab === 'videos';
  const showTags = tab === 'all' || tab === 'tags';

  // Busca en internet solo cuando el usuario abre la pestaña de música o de
  // vídeo de fuera. Se vuelve a pedir si cambia el término o la pestaña.
  useEffect(() => {
    const term = query.trim();
    if (!term || (tab !== 'music' && tab !== 'external')) return undefined;

    setExtLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/discover/search', {
          params: { q: term, kind: tab === 'music' ? 'music' : 'video', limit: 20 },
        });
        setExternal({ music: data.music || [], videos: data.videos || [] });
      } catch (err) {
        setError(err.message);
      } finally {
        setExtLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, tab]);

  // Trae a TAK TAK lo elegido. La música se guarda como sonido reutilizable (así
  // aparece en el selector de «Subir» para ponerla a un vídeo o foto); el vídeo
  // se publica directamente en el feed.
  async function importItem(item) {
    setImporting(item.id);
    setNotice('');
    setError('');
    try {
      const { data } = await api.post('/discover/import', {
        url: item.kind === 'music' ? item.audioUrl : item.videoUrl,
        kind: item.kind,
      });
      // En desarrollo el archivo se sirve en `/uploads/...` (relativo) y la API
      // exige una URL absoluta; en producción ya llega la del bucket.
      const absoluteUrl = data.url.startsWith('http')
        ? data.url
        : `${window.location.origin}${data.url}`;

      if (item.kind === 'music') {
        await api.post('/sounds', {
          title: item.title,
          artist: item.artist,
          audioUrl: absoluteUrl,
        });
        setNotice(`«${item.title}» añadida a tu música. Ya puedes usarla al subir.`);
      } else {
        await api.post('/videos', {
          title: item.title,
          videoUrl: absoluteUrl,
        });
        setNotice(`«${item.title}» publicada en tu perfil.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting('');
    }
  }

  return (
    <div className="explore">
      <div className="screen-head">
        <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h2>🔍 Explorar</h2>
      </div>

      <form className="explore-search" onSubmit={(e) => e.preventDefault()}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busca personas, vídeos, #etiquetas o música"
          aria-label="Buscar en TAK TAK y en internet"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Borrar búsqueda"
          >
            ✖
          </button>
        )}
      </form>

      {query.trim() && (
        <div className="explore-tabs" role="tablist" aria-label="Tipo de resultado">
          {[
            { id: 'all', label: 'Todo' },
            { id: 'users', label: `Personas${results.users.length ? ` (${results.users.length})` : ''}` },
            { id: 'videos', label: `Vídeos${results.videos.length ? ` (${results.videos.length})` : ''}` },
            { id: 'tags', label: 'Etiquetas' },
            { id: 'music', label: '🎵 Música' },
            { id: 'external', label: '🎬 De internet' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`explore-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!query.trim() && (
        <div className="explore-empty">
          <p className="muted">
            Escribe un nombre, un @usuario o una etiqueta. Encuentra a quien quieras
            y vuelve a los vídeos que te gustaron.
          </p>
        </div>
      )}

      {query.trim() && loading && total === 0 && <p className="muted">Buscando…</p>}

      {query.trim() && !loading && total === 0 && !error && tab !== 'music' && tab !== 'external' && (
        <p className="muted">Nada coincide con “{query.trim()}”. Prueba con otra palabra.</p>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {showTags && results.tags.length > 0 && (
        <div className="explore-tags">
          {results.tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              className="explore-tag"
              onClick={() => onOpenTag?.(t.tag)}
            >
              #{t.tag} <small>{formatCount(t.count)}</small>
            </button>
          ))}
        </div>
      )}

      {showUsers && results.users.length > 0 && (
        <section className="explore-section">
          <h3>Personas</h3>
          <ul className="search-list">
            {results.users.map((u) => (
              <UserResult
                key={u.id}
                user={u}
                onOpen={(person) => onOpenProfile?.(person)}
                onReport={(type, item) => setReport({ type, item })}
              />
            ))}
          </ul>
        </section>
      )}

      {showVideos && results.videos.length > 0 && (
        <section className="explore-section">
          <h3>Vídeos</h3>
          <ul className="search-list">
            {results.videos.map((v) => (
              <VideoResult
                key={v.id}
                video={v}
                onOpen={(video) => onOpenVideo?.(video)}
                onReport={(type, item) => setReport({ type, item })}
              />
            ))}
          </ul>
        </section>
      )}

      {tab === 'music' && (
        <section className="explore-section">
          <h3>🎵 Música de internet</h3>
          <p className="muted">
            Pistas con licencia libre (Creative Commons). Al usar una, se copia a TAK TAK y
            queda en tu música para ponérsela a tus vídeos o fotos.
          </p>
          {extLoading && <p className="muted">Buscando…</p>}
          {!extLoading && external.music.length === 0 && (
            <p className="muted">Sin resultados de música para “{query.trim()}”.</p>
          )}
          <ul className="search-list">
            {external.music.map((item) => (
              <li key={item.id} className="ext-item">
                <div className="ext-item-body">
                  <strong>{item.title}</strong>
                  <span className="muted">{item.artist}</span>
                  <small className="muted">
                    {item.license} · {item.provider}
                  </small>
                  {item.audioUrl && (
                    <audio
                      controls
                      preload="none"
                      src={`/api/discover/preview?url=${encodeURIComponent(item.audioUrl)}`}
                    />
                  )}
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={importing === item.id}
                  onClick={() => importItem(item)}
                >
                  {importing === item.id ? 'Trayendo…' : 'Usar en TakTak'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'external' && (
        <section className="explore-section">
          <h3>🎬 Vídeos de internet</h3>
          <p className="muted">
            Vídeos con licencia libre de Wikimedia Commons. Al publicar uno, se copia a TAK TAK
            y aparece en tu perfil.
          </p>
          {extLoading && <p className="muted">Buscando…</p>}
          {!extLoading && external.videos.length === 0 && (
            <p className="muted">Sin resultados de vídeo para “{query.trim()}”.</p>
          )}
          <ul className="search-list">
            {external.videos.map((item) => (
              <li key={item.id} className="ext-item">
                {item.thumbnailUrl && (
                  <img
                    className="ext-thumb"
                    src={`/api/discover/preview?url=${encodeURIComponent(item.thumbnailUrl)}`}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className="ext-item-body">
                  <strong>{item.title}</strong>
                  <small className="muted">
                    {item.license} · {item.provider}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={importing === item.id}
                  onClick={() => importItem(item)}
                >
                  {importing === item.id ? 'Trayendo…' : 'Publicar'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <ReportDialog
          targetType={report.type}
          target={report.item}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
}