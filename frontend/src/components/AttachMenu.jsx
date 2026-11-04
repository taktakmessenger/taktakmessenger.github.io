import { useEffect, useRef, useState } from 'react';
import {
  GalleryIcon,
  CameraIcon,
  LocationIcon,
  ContactIcon,
  DocumentIcon,
  PollIcon,
  EventIcon,
  CloseIcon,
} from './ChatIcons';

// Menú de adjuntos del chat, con las siete opciones de WhatsApp: galería,
// cámara, ubicación, contacto, documento, encuesta y evento.
//
// Se abre al tocar el clip y aparece como un panel que sube desde abajo, con el
// gesto de hoja que ya usa el resto de la app. Cada opción es un botón real:
// - Galería y Documento abren el selector de archivos del sistema.
// - Cámara abre un diálogo con `<input capture>` para hacer la foto en el sitio.
// - Ubicación, Contacto, Encuesta y Evento abren un formulario propio.
//
// El componente no habla con la API: recoge la elección del usuario y llama a
// `onPick` con lo necesario para enviarlo. Así el envío reutiliza el mismo
// camino que un mensaje normal (copia optimista + POST + mergeMessage).
export default function AttachMenu({ open, onClose, onPick, disabled = false }) {
  const [dialog, setDialog] = useState(null);
  const sheetRef = useRef(null);

  // Escape cierra, como el resto de paneles de la app.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') {
        if (dialog) setDialog(null);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dialog, onClose]);

  // Al cerrar el menú se cierra también cualquier formulario abierto dentro,
  // para que al reabrirlo no aparezca a medias.
  useEffect(() => {
    if (!open) setDialog(null);
  }, [open]);

  if (!open) return null;

  function choose(kind) {
    if (disabled) return;
    if (kind === 'gallery' || kind === 'document' || kind === 'camera') {
      // El padre abre el selector con el `accept`/`capture` correcto.
      onPick({ type: kind });
      onClose();
      return;
    }
    setDialog(kind);
  }

  function submit(payload) {
    onPick(payload);
    setDialog(null);
    onClose();
  }

  const options = [
    { key: 'gallery', label: 'Galería', Icon: GalleryIcon, tint: 'violet' },
    { key: 'camera', label: 'Cámara', Icon: CameraIcon, tint: 'pink' },
    { key: 'location', label: 'Ubicación', Icon: LocationIcon, tint: 'cyan' },
    { key: 'contact', label: 'Contacto', Icon: ContactIcon, tint: 'violet' },
    { key: 'document', label: 'Documento', Icon: DocumentIcon, tint: 'amber' },
    { key: 'poll', label: 'Encuesta', Icon: PollIcon, tint: 'pink' },
    { key: 'event', label: 'Eventos', Icon: EventIcon, tint: 'cyan' },
  ];

  return (
    <div className="attach-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="attach-sheet" ref={sheetRef} role="dialog" aria-label="Adjuntar">
        <div className="attach-sheet-head">
          <span>Adjuntar</span>
          <button type="button" className="attach-close" onClick={onClose} aria-label="Cerrar">
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="attach-grid">
          {options.map(({ key, label, Icon, tint }) => (
            <button
              key={key}
              type="button"
              className="attach-option"
              onClick={() => choose(key)}
              disabled={disabled}
            >
              <span className={`attach-icon attach-icon-${tint}`} aria-hidden="true">
                <Icon size={24} />
              </span>
              <small>{label}</small>
            </button>
          ))}
        </div>
      </div>

      {dialog === 'location' && <LocationForm onCancel={() => setDialog(null)} onSubmit={submit} />}
      {dialog === 'contact' && <ContactForm onCancel={() => setDialog(null)} onSubmit={submit} />}
      {dialog === 'poll' && <PollForm onCancel={() => setDialog(null)} onSubmit={submit} />}
      {dialog === 'event' && <EventForm onCancel={() => setDialog(null)} onSubmit={submit} />}
    </div>
  );
}

// --- Formularios de cada tipo rico ---

// Comparten el mismo diálogo centrado y los mismos estilos; solo cambian los
// campos. Se agrupan aquí para no repartir cuatro ficheros casi iguales.
function FormDialog({ title, onCancel, onSubmit, submitLabel = 'Enviar', children, disabled }) {
  return (
    <div className="rich-form-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="rich-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h3>{title}</h3>
        {children}
        <div className="rich-form-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={disabled}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function LocationForm({ onCancel, onSubmit }) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);

  // El navegador da la posición actual; si el usuario la deniega o el móvil no
  // la tiene, siempre puede escribir las coordenadas a mano.
  function useCurrent() {
    if (!navigator.geolocation) {
      setError('Este dispositivo no da la ubicación');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setError('No se pudo obtener la ubicación');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const valid = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== '' && lng !== '';

  return (
    <FormDialog
      title="Compartir ubicación"
      onCancel={onCancel}
      disabled={!valid}
      onSubmit={() => onSubmit({ type: 'location', lat: Number(lat), lng: Number(lng), placeName: placeName.trim() })}
    >
      <button type="button" className="rich-inline-btn" onClick={useCurrent} disabled={locating}>
        {locating ? 'Buscando…' : '📍 Usar mi ubicación actual'}
      </button>
      <label>
        Latitud
        <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="19.4326" />
      </label>
      <label>
        Longitud
        <input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-99.1332" />
      </label>
      <label>
        Nombre del sitio (opcional)
        <input type="text" value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Casa, oficina…" maxLength={120} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
    </FormDialog>
  );
}

function ContactForm({ onCancel, onSubmit }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const valid = name.trim() || phone.trim();

  return (
    <FormDialog
      title="Compartir contacto"
      onCancel={onCancel}
      disabled={!valid}
      onSubmit={() => onSubmit({ type: 'contact', name: name.trim(), phone: phone.trim() })}
    >
      <label>
        Nombre
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marta Ruiz" maxLength={80} />
      </label>
      <label>
        Teléfono
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 600 123 456" maxLength={40} />
      </label>
    </FormDialog>
  );
}

function PollForm({ onCancel, onSubmit }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim() && filled.length >= 2;

  function setOption(index, value) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  return (
    <FormDialog
      title="Crear encuesta"
      onCancel={onCancel}
      disabled={!valid}
      onSubmit={() => onSubmit({ type: 'poll', question: question.trim(), options: filled, allowMultiple })}
    >
      <label>
        Pregunta
        <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Cenamos el viernes?" maxLength={200} />
      </label>
      <span className="rich-form-label">Opciones</span>
      {options.map((option, index) => (
        <div className="rich-option-row" key={index}>
          <input
            type="text"
            value={option}
            onChange={(e) => setOption(index, e.target.value)}
            placeholder={`Opción ${index + 1}`}
            maxLength={80}
          />
          {options.length > 2 && (
            <button
              type="button"
              className="rich-option-remove"
              onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
              aria-label={`Quitar opción ${index + 1}`}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {options.length < 12 && (
        <button type="button" className="rich-inline-btn" onClick={() => setOptions((prev) => [...prev, ''])}>
          + Añadir opción
        </button>
      )}
      <label className="rich-check">
        <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
        Permitir varias respuestas
      </label>
    </FormDialog>
  );
}

function EventForm({ onCancel, onSubmit }) {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const valid = title.trim() && startsAt;

  return (
    <FormDialog
      title="Crear evento"
      onCancel={onCancel}
      disabled={!valid}
      onSubmit={() =>
        onSubmit({
          type: 'event',
          title: title.trim(),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
          location: location.trim(),
          notes: notes.trim(),
        })
      }
    >
      <label>
        Título
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cumpleaños de Ana" maxLength={140} />
      </label>
      <label>
        Empieza
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </label>
      <label>
        Termina (opcional)
        <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </label>
      <label>
        Lugar (opcional)
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Casa de Ana" maxLength={160} />
      </label>
      <label>
        Notas (opcional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
      </label>
    </FormDialog>
  );
}
