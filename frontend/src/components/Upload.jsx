import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

const FILTERS = [
  { id: 'none', label: 'Normal' },
  { id: 'grayscale', label: 'B/N' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'vivid', label: 'Vivo' },
  { id: 'cool', label: 'Frío' },
];

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

      await api.post('/videos/upload', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-card">
      <h2>Crear contenido</h2>

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
            startCamera();
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
                onClick={startRecording}
                disabled={!cameraReady}
              >
                🔴 Grabar
              </button>
            ) : (
              <button type="button" className="btn-danger" onClick={stopRecording}>
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
        <input type="file" accept="video/*" onChange={pickFile} />
      )}

      {preview && (
        <video className="preview-video" src={preview} controls playsInline />
      )}

      <form onSubmit={handleSubmit}>
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
    </div>
  );
}
