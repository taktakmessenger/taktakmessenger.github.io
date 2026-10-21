import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

const FILTERS = [
  { id: 'none', label: 'Normal' },
  { id: 'grayscale', label: 'B/N' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'vivid', label: 'Vivo' },
  { id: 'cool', label: 'Frío' },
];

// La conversión a HLS corre en segundo plano tras publicar. Estos son los
// estados que puede devolver `/videos/:id/status`.
const OPTIMIZE_POLL_MS = 3000;
const OPTIMIZE_MAX_TRIES = 100; // ~5 minutos

export default function Upload({ onUploaded }) {
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const [mode, setMode] = useState('file');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [filter, setFilter] = useState('none');
  const [form, setForm] = useState({ title: '', description: '', tags: '' });
  const [isNSFW, setIsNSFW] = useState(false);
  const [newsSource, setNewsSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Tras publicar, se sigue el estado de la conversión hasta que termina.
  const [optimizing, setOptimizing] = useState(null); // { id, status, error }
  const pollRef = useRef(null);

  // Only verified newsrooms are offered, because claiming any other source
  // could never earn the badge.
  useEffect(() => {
    api
      .get('/videos/news-sources')
      .then(({ data }) => setSources(data.sources))
      .catch(() => setSources([]));
  }, []);

  // Release the camera when the view unmounts, otherwise the light stays on.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  // Un sondeo pendiente debe morir con la pantalla; si no, sigue consultando
  // por un vídeo que ya no se está mirando.
  useEffect(() => () => clearTimeout(pollRef.current), []);

  // Sondea el estado hasta que el vídeo queda optimizado o falla. Se para en
  // cuanto hay respuesta terminal, así que no se queda consultando en bucle.
  function watchOptimization(id) {
    let tries = 0;

    async function tick() {
      tries += 1;
      try {
        const { data } = await api.get(`/videos/${id}/status`);
        if (data.transcodeStatus === 'ready') {
          setOptimizing({ id, status: 'ready' });
          return;
        }
        if (data.transcodeStatus === 'failed') {
          setOptimizing({ id, status: 'failed', error: data.transcodeError });
          return;
        }
      } catch {
        // Un fallo de red puntual no debe cancelar el seguimiento: se reintenta
        // en el siguiente tick.
      }

      if (tries >= OPTIMIZE_MAX_TRIES) {
        setOptimizing({ id, status: 'timeout' });
        return;
      }
      pollRef.current = setTimeout(tick, OPTIMIZE_POLL_MS);
    }

    pollRef.current = setTimeout(tick, OPTIMIZE_POLL_MS);
  }

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
    } catch {
      setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    // Pick a codec the browser actually supports instead of assuming vp9.
    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((t) => window.MediaRecorder?.isTypeSupported?.(t));

    if (!mimeType) {
      setError('Tu navegador no soporta grabar video.');
      return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setFile(new File([blob], 'taktak-grabacion.webm', { type: 'video/webm' }));
      setPreview(URL.createObjectURL(blob));
    };

    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function pickFile(e) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setError('');
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) {
      setError('Elige o graba un video primero.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('video', file);
      body.append('title', form.title);
      if (form.description) body.append('description', form.description);
      if (form.tags) body.append('tags', form.tags);
      body.append('isNSFW', String(isNSFW));
      if (newsSource) {
        body.append('newsSource', newsSource);
        body.append('sourceUrl', sourceUrl);
      }

      const { data } = await api.post('/videos/upload', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // No se navega todavía: se muestra "optimizando" y se sigue el estado. Si
      // el navegador no puede reproducir el original (H.265 de iPhone), este es
      // el momento en que se convierte en algo reproducible.
      setOptimizing({ id: data.video._id, status: 'processing' });
      watchOptimization(data.video._id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-card">
      <h2>Crear contenido</h2>

      {optimizing ? (
        <OptimizePanel
          state={optimizing}
          onGoToFeed={() => onUploaded?.()}
          onRetry={() => {
            setOptimizing({ id: optimizing.id, status: 'processing' });
            api
              .post(`/videos/${optimizing.id}/retranscode`)
              .then(() => watchOptimization(optimizing.id))
              .catch((err) => setOptimizing({ id: optimizing.id, status: 'failed', error: err.message }));
          }}
          onNew={() => setOptimizing(null)}
        />
      ) : (
        <UploadForm
          mode={mode}
          setMode={setMode}
          file={file}
          preview={preview}
          cameraReady={cameraReady}
          recording={recording}
          filter={filter}
          setFilter={setFilter}
          form={form}
          update={update}
          isNSFW={isNSFW}
          setIsNSFW={setIsNSFW}
          sources={sources}
          newsSource={newsSource}
          setNewsSource={setNewsSource}
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          error={error}
          busy={busy}
          onPickFile={pickFile}
          onStartCamera={startCamera}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onSubmit={handleSubmit}
          videoRef={videoRef}
        />
      )}
    </div>
  );
}

// Aviso de progreso tras publicar. La conversión a HLS decide si el vídeo se
// podrá ver y oír en el navegador, así que el resultado se muestra aquí en vez
// de dejar al creador con un vídeo que "no suena" y sin explicación.
function OptimizePanel({ state, onGoToFeed, onRetry, onNew }) {
  const { status, error } = state;

  if (status === 'processing') {
    return (
      <div className="optimize-panel">
        <p className="optimize-title">⏳ Optimizando tu vídeo…</p>
        <p className="hint">
          Lo estamos convirtiendo para que se vea y suene en todos los móviles y
          navegadores. Puedes esperar aquí o ir al feed; el vídeo ya está publicado.
        </p>
        <button type="button" className="btn-ghost" onClick={onGoToFeed}>
          Ir al feed
        </button>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div className="optimize-panel">
        <p className="optimize-title">✅ ¡Listo!</p>
        <p className="hint">Tu vídeo ya está optimizado y se reproduce en todas partes.</p>
        <div className="optimize-actions">
          <button type="button" className="btn-primary" onClick={onGoToFeed}>
            Ver en el feed
          </button>
          <button type="button" className="btn-ghost" onClick={onNew}>
            Subir otro
          </button>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="optimize-panel">
        <p className="optimize-title">⚠️ No se pudo optimizar</p>
        <p className="hint">
          El vídeo se publicó, pero puede que no se vea en algunos navegadores.
          {error ? ` Detalle: ${error}` : ''}
        </p>
        <div className="optimize-actions">
          <button type="button" className="btn-primary" onClick={onRetry}>
            🔄 Reintentar
          </button>
          <button type="button" className="btn-ghost" onClick={onGoToFeed}>
            Ir al feed
          </button>
        </div>
      </div>
    );
  }

  // timeout: el servidor sigue trabajando o se quedó atascado. No es un error
  // definitivo, así que se ofrece reintentar y volver al feed.
  return (
    <div className="optimize-panel">
      <p className="optimize-title">⏳ Sigue optimizándose</p>
      <p className="hint">
        Está tardando más de lo esperado. Puedes volver al feed: se actualizará solo.
      </p>
      <div className="optimize-actions">
        <button type="button" className="btn-primary" onClick={onRetry}>
          🔄 Reintentar
        </button>
        <button type="button" className="btn-ghost" onClick={onGoToFeed}>
          Ir al feed
        </button>
      </div>
    </div>
  );
}

function UploadForm({
  mode,
  setMode,
  file,
  preview,
  cameraReady,
  recording,
  filter,
  setFilter,
  form,
  update,
  isNSFW,
  setIsNSFW,
  sources,
  newsSource,
  setNewsSource,
  sourceUrl,
  setSourceUrl,
  error,
  busy,
  onPickFile,
  onStartCamera,
  onStartRecording,
  onStopRecording,
  onSubmit,
  videoRef,
}) {
  return (
    <>
      <div className="mode-switch">
        <button
          type="button"
          className={mode === 'file' ? 'btn-primary' : 'btn-ghost'}
          onClick={() => setMode('file')}
        >
          📁 Subir archivo
        </button>
        <button
          type="button"
          className={mode === 'camera' ? 'btn-primary' : 'btn-ghost'}
          onClick={() => {
            setMode('camera');
            onStartCamera();
          }}
        >
          🎥 Grabar con cámara
        </button>
      </div>

      {mode === 'camera' && (
        <>
          <video
            ref={videoRef}
            className={`preview-video filter-${filter}`}
            autoPlay
            muted
            playsInline
          />
          <div className="filters-bar">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={filter === f.id ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="control-buttons">
            {!recording ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onStartRecording}
                disabled={!cameraReady}
              >
                🔴 Grabar
              </button>
            ) : (
              <button type="button" className="btn-danger" onClick={onStopRecording}>
                ⏹️ Detener
              </button>
            )}
          </div>
          <p className="hint">
            La cámara graba sin filtros; el filtro es solo una vista previa.
          </p>
        </>
      )}

      {mode === 'file' && (
        <input type="file" accept="video/*" onChange={onPickFile} />
      )}

      {preview && (
        <video className="preview-video" src={preview} controls playsInline />
      )}

      <form onSubmit={onSubmit}>
        <input
          type="text"
          placeholder="Título"
          value={form.title}
          onChange={update('title')}
          required
          maxLength={100}
        />
        <textarea
          placeholder="Descripción (opcional)"
          value={form.description}
          onChange={update('description')}
          maxLength={500}
          rows={3}
        />
        <input
          type="text"
          placeholder="Etiquetas separadas por coma (ej. baile, comedia)"
          value={form.tags}
          onChange={update('tags')}
        />

        <label className="upload-toggle">
          <input
            type="checkbox"
            checked={isNSFW}
            onChange={(e) => setIsNSFW(e.target.checked)}
          />
          Contenido para adultos (requiere verificación de edad)
        </label>

        {sources.length > 0 && (
          <fieldset className="upload-news">
            <legend>¿Es una noticia?</legend>
            <select value={newsSource} onChange={(e) => setNewsSource(e.target.value)}>
              <option value="">No, es contenido propio</option>
              {sources.map((s) => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
            {newsSource && (
              <>
                <input
                  type="url"
                  placeholder="Enlace a la noticia original"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  required
                />
                <small className="muted">
                  Un revisor comprobará el enlace antes de mostrar el sello.
                </small>
              </>
            )}
          </fieldset>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <button type="submit" className="btn-primary" disabled={busy || !file}>
          {busy ? 'Publicando…' : '🚀 Publicar'}
        </button>
      </form>
    </>
  );
}
