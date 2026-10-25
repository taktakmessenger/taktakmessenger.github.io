import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';
import { loadProviders } from '../lib/providers';
import { matches } from '../lib/search';

// Banderas a partir del código ISO. Se derivan del código en vez de guardar una
// tabla: 245 países a mano se desincronizan, y el emoji regional se calcula.
function flagEmoji(code) {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const KEYS = [
  { digit: '1', sub: '' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: '' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: '' },
];

// Mantener pulsado el 0 debe escribir el prefijo internacional "+". En el
// marcador antiguo esto no funcionaba: solo había `click`, así que el 0 largo
// añadía un 0. Y el móvil abría su menú contextual al mantener pulsado, que
// cancelaba la pulsación larga antes de que pudiéramos reaccionar.
const LONG_PRESS_MS = 500;

export default function Dialer({ onCall, onOpenChat }) {
  const [number, setNumber] = useState('');
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Listo para llamar');
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(null);
  // Resultado de buscar el número cuando NO tiene cuenta: es lo que habilita
  // las alternativas (llamar por teléfono o invitar por SMS).
  const [unknown, setUnknown] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactsState, setContactsState] = useState('idle');
  const [contactDraft, setContactDraft] = useState({ name: '', phone: '' });
  // Voz o vídeo. La videollamada solo existe entre cuentas de TAK TAK: a un
  // teléfono normal se le puede llamar por voz, no con vídeo, porque no hay
  // dónde entregarle la imagen.
  const [callKind, setCallKind] = useState('audio');
  const [voiceAvailable, setVoiceAvailable] = useState(false);

  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);
  const pickerRef = useRef(null);

  // La lista de países sale de libphonenumber en el servidor, así que cubre
  // todos los territorios y los prefijos están al día.
  //
  // Se reintenta con espera creciente porque este es el primer momento de la
  // sesión: justo cuando la app arranca (o el usuario entra nada más
  // reiniciarse), el backend puede tardar unos segundos en responder y una sola
  // intentona fallida dejaba el marcador sin códigos de área hasta recargar.
  useEffect(() => {
    let cancelled = false;
    loadProviders(() => api.get('/auth/providers'), { shouldAbort: () => cancelled })
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data.countries) ? data.countries : [];
        setCountries(list);
        setVoiceAvailable(Boolean(data.voice));
        // Preselecciona el país del navegador si está en la lista, para no
        // obligar a buscarlo cada vez. Si no coincide, se queda sin país y el
        // usuario escribe el prefijo internacional.
        const guessed = navigator.language?.split('-')[1];
        const match = list.find((c) => c.code === guessed);
        if (match) setCountry(match);
      })
      .catch(() => {
        // Se agotan los reintentos: el marcador queda sin prefijos, pero el
        // usuario aún puede escribir el número con "+" y buscar por nombre.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetResolution() {
    setResolved(null);
    setUnknown(null);
    setStatus('Listo para llamar');
  }

  function append(char) {
    resetResolution();
    setNumber((prev) => prev + char);
  }

  function backspace() {
    resetResolution();
    setNumber((prev) => prev.slice(0, -1));
  }

  // Pulsación normal: escribe el dígito. Pulsación larga en el 0: escribe "+".
  function pressStart(digit) {
    longPressFired.current = false;
    if (digit !== '0') return;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      append('+');
      setStatus('Prefijo internacional listo: escribe el código de país');
    }, LONG_PRESS_MS);
  }

  function pressEnd(digit) {
    clearTimeout(longPressTimer.current);
    // Si la pulsación larga ya escribió el "+", soltar el dedo no debe añadir
    // además un 0: el usuario quería el prefijo, no las dos cosas.
    if (longPressFired.current) return;
    append(digit);
  }

  function pressCancel() {
    clearTimeout(longPressTimer.current);
  }

  useEffect(() => () => clearTimeout(longPressTimer.current), []);

  // El selector de país se cierra al tocar fuera o con Escape. Antes no había
  // forma de cerrarlo sin elegir un país: quien lo abría por error (o no
  // encontraba el suyo) se quedaba con él encima del marcador y creía que la
  // pantalla se había quedado colgada.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    function onDown(event) {
      // El propio botón que abre el selector se excluye: si no, el pointerdown
      // lo cerraría y el click que viene después lo volvería a abrir, dejándolo
      // imposible de cerrar desde el botón.
      if (event.target.closest?.('.dialer-country-btn')) return;
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setPickerOpen(false);
      }
    }
    function onKey(event) {
      if (event.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // Contactos del teléfono. `navigator.contacts` solo existe en algunos
  // navegadores móviles y exige permiso explícito, así que se pide con un botón
  // y no al montar: pedir contactos nada más abrir el marcador es invasivo y en
  // la mayoría de navegadores de escritorio ni siquiera existe la API.
  async function importContacts() {
    if (!navigator.contacts?.select) {
      setContactsState('unsupported');
      return;
    }

    setContactsState('loading');
    try {
      const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      const list = [];
      for (const entry of picked || []) {
        const name = entry.name?.[0] || 'Sin nombre';
        for (const tel of entry.tel || []) {
          list.push({ name, phone: tel });
        }
      }
      setContacts(list);
      setContactsState(list.length ? 'ready' : 'empty');
    } catch {
      // El usuario cerró el diálogo o denegó el permiso: no es un error que
      // haya que gritar.
      setContactsState('denied');
    }
  }

  // Contactos guardados a mano. Se persisten en el propio dispositivo porque son
  // una libreta local, no una lista de la cuenta: no hay razón para subirlos al
  // servidor ni para perderlos al recargar.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('taktak_contacts') || '[]');
      if (Array.isArray(saved) && saved.length) {
        setContacts((prev) => [...prev, ...saved]);
        setContactsState('ready');
      }
    } catch {
      // Un almacenamiento corrupto no debe romper el marcador.
    }
  }, []);

  function addContact(event) {
    event.preventDefault();
    const name = contactDraft.name.trim();
    const phone = contactDraft.phone.trim();
    if (!name || !phone) return;
    const entry = { name, phone, manual: true };
    setContacts((prev) => {
      if (prev.some((c) => c.name === name && c.phone === phone)) return prev;
      const next = [...prev, entry];
      try {
        localStorage.setItem('taktak_contacts', JSON.stringify(next.filter((c) => c.manual)));
      } catch {
        // Sin almacenamiento, el contacto sigue usable en esta sesión.
      }
      return next;
    });
    setContactDraft({ name: '', phone: '' });
    setContactsState('ready');
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    // Se compara sin acentos: quien busca su país escribe "peru", "mexico" o
    // "caiman", no la grafía acentuada. Comparar en crudo dejaba esos términos
    // sin resultados y parecía que el selector no encontraba nada.
    return countries.filter(
      (c) =>
        matches(c.name, q) ||
        matches(c.dialCode, q) ||
        matches(c.code, q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase() === q
    );
  }, [countries, search]);

  // Resuelve el número a una cuenta de TAK TAK. Se resuelve en el servidor
  // porque el cliente no puede saber a quién pertenece un teléfono, y no debe:
  // la búsqueda va autenticada y limitada.
  //
  // Si el número NO tiene cuenta, no es un callejón sin salida: se ofrecen las
  // dos alternativas reales (llamada telefónica normal o invitar por SMS).
  async function resolve() {
    const raw = number.trim();
    if (!raw || busy) return null;

    setBusy(true);
    setStatus('Buscando…');
    setResolved(null);
    setUnknown(null);

    // Un @usuario se busca como cuenta, no como número. Es la única forma de
    // llamar a quien se registró con correo: esas cuentas no tienen teléfono,
    // así que la búsqueda por número nunca las encuentra y la videollamada
    // quedaba inalcanzable desde el marcador aunque la otra persona sí pueda
    // recibirla.
    if (raw.startsWith('@') || /^[a-zA-Z]/.test(raw)) {
      const username = raw.replace(/^@/, '');
      try {
        const { data } = await api.get(`/users/${encodeURIComponent(username)}`);
        const found = { ...data.user, id: data.user._id || data.user.id };
        setResolved(found);
        setStatus(`@${found.username} está en TAK TAK`);
        return found;
      } catch (err) {
        setStatus(err.message);
        return null;
      } finally {
        setBusy(false);
      }
    }

    try {
      const { data } = await api.post('/users/lookup-phone', {
        phone: raw,
        country: country?.code,
      });
      setResolved(data.user);
      setStatus(`@${data.user.username} está en TAK TAK`);
      return data.user;
    } catch (err) {
      // Solo "no existe" habilita las alternativas. Un número inválido o sin
      // sesión es un error y se queda como error.
      if (/no hay ninguna cuenta/i.test(err.message)) {
        setUnknown({ phone: raw });
        setStatus('Ese número no tiene TAK TAK');
      } else {
        setStatus(err.message);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Llamada entre cuentas de TAK TAK: WebRTC, con vídeo si se ha elegido.
  async function callApp() {
    const user = resolved || (await resolve());
    if (!user) return;
    onCall?.(user, callKind);
  }

  // Llamada a un teléfono normal. Se intenta primero por Twilio Voice, que
  // funciona también desde el escritorio; si no hay proveedor configurado, cae
  // al marcador del sistema (`tel:`), que en un móvil marca de verdad sin
  // depender de nada.
  async function callNative() {
    const digits = number.trim();
    if (!digits) return;

    if (!voiceAvailable) {
      window.location.href = `tel:${encodeURIComponent(digits)}`;
      setStatus('Llamada abierta en el teléfono');
      return;
    }

    setBusy(true);
    setStatus('Llamando por teléfono…');
    try {
      // El SDK se carga solo cuando de verdad se va a usar: pesa bastante y la
      // mayoría de la gente no llama a un teléfono normal en cada sesión.
      const { Device } = await import('@twilio/voice-sdk');
      const { data } = await api.post('/calls/token');

      const device = new Device(data.token, { logLevel: 'error' });
      await device.register();

      const call = await device.connect({ params: { To: digits } });
      call.on('disconnect', () => {
        device.destroy();
        setStatus('Llamada finalizada');
        setBusy(false);
      });
      call.on('error', () => {
        device.destroy();
        setStatus('La llamada falló');
        setBusy(false);
      });

      setStatus('En llamada…');
    } catch (err) {
      // Si Twilio falla (sin red, credenciales caducadas), el marcador del
      // sistema sigue siendo una salida válida en un móvil.
      setStatus(`${err.message || 'No se pudo llamar'}. Abriendo el marcador…`);
      window.location.href = `tel:${encodeURIComponent(digits)}`;
    } finally {
      setBusy(false);
    }
  }

  // Invita por SMS a un número que no tiene la app.
  async function invite() {
    const digits = number.trim();
    if (!digits || busy) return;

    setBusy(true);
    setStatus('Enviando invitación…');
    try {
      const { data } = await api.post('/calls/invite', {
        phone: digits,
        country: country?.code,
      });
      setStatus(
        data.delivered
          ? `Invitación enviada a ${data.to}`
          : 'No hay proveedor de SMS: copia el enlace y compártelo'
      );
      setUnknown((prev) => ({ ...prev, inviteLink: data.inviteLink, delivered: data.delivered }));
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialer">
      <div className="dialer-status" role="status">
        {status}
      </div>

      <div className="dialer-kind" role="group" aria-label="Tipo de llamada">
        <button
          type="button"
          className={`dialer-kind-btn ${callKind === 'audio' ? 'active' : ''}`}
          onClick={() => setCallKind('audio')}
          aria-pressed={callKind === 'audio'}
        >
          📞 Voz
        </button>
        <button
          type="button"
          className={`dialer-kind-btn ${callKind === 'video' ? 'active' : ''}`}
          onClick={() => setCallKind('video')}
          aria-pressed={callKind === 'video'}
        >
          🎥 Vídeo
        </button>
      </div>

      <div className="dialer-country-row">
        <button
          type="button"
          className="dialer-country-btn"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Elegir país"
        >
          <span className="dialer-flag" aria-hidden="true">
            {flagEmoji(country?.code)}
          </span>
          <span className="dialer-dial">{country?.dialCode || '🌐'}</span>
        </button>

        <input
          type="text"
          inputMode="text"
          className="dialer-number"
          placeholder="Número o @usuario"
          value={number}
          onChange={(e) => {
            resetResolution();
            setNumber(e.target.value);
          }}
          aria-label="Número de teléfono o usuario"
        />
      </div>

      {pickerOpen && (
        <div className="dialer-picker" ref={pickerRef}>
          <input
            type="search"
            className="dialer-picker-search"
            placeholder="Buscar país o prefijo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar país"
          />
          <div className="dialer-picker-list">
            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                className="dialer-picker-item"
                onClick={() => {
                  setCountry(c);
                  setPickerOpen(false);
                  setSearch('');
                }}
              >
                <span aria-hidden="true">{flagEmoji(c.code)}</span>
                <span>{c.name}</span>
                <span className="dialer-picker-dial">{c.dialCode}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="muted dialer-no-result">Sin resultados</p>}
          </div>
        </div>
      )}

      <div className="dialer-grid">
        {KEYS.map(({ digit, sub }) => (
          <button
            key={digit}
            type="button"
            className="dialer-key"
            // Pointer events en lugar de click: el click no distingue una
            // pulsación corta de una larga, que es justo lo que hace falta aquí.
            onPointerDown={() => pressStart(digit)}
            onPointerUp={() => pressEnd(digit)}
            onPointerLeave={pressCancel}
            onPointerCancel={pressCancel}
            // El menú contextual del móvil cancela la pulsación larga, así que
            // se desactiva en el propio botón.
            onContextMenu={(e) => e.preventDefault()}
            aria-label={digit === '0' ? '0, mantén pulsado para el prefijo más' : digit}
          >
            <span className="dialer-digit">{digit}</span>
            {sub && <span className="dialer-sub">{sub}</span>}
          </button>
        ))}
      </div>

      <div className="dialer-actions">
        <button
          type="button"
          className="dialer-backspace"
          onClick={backspace}
          aria-label="Borrar"
          disabled={!number}
        >
          ⌫
        </button>
        <button
          type="button"
          className="dialer-call"
          onClick={callApp}
          disabled={!number.trim() || busy}
          aria-label={callKind === 'video' ? 'Videollamada' : 'Llamar'}
        >
          {callKind === 'video' ? '🎥' : '📞'}
        </button>
        <button
          type="button"
          className="dialer-clear"
          onClick={() => {
            setNumber('');
            resetResolution();
          }}
          aria-label="Limpiar"
          disabled={!number}
        >
          ✖
        </button>
      </div>

      {resolved && (
        <div className="dialer-resolved">
          <span className="muted">En TAK TAK</span>
          <strong>@{resolved.username}</strong>
          {onOpenChat && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onOpenChat(resolved)}
            >
              💬 Abrir chat
            </button>
          )}
        </div>
      )}

      {/* El número no tiene cuenta. No es un error: se ofrecen las dos salidas
          reales. La videollamada no aparece porque no hay dónde entregarla. */}
      {unknown && (
        <div className="dialer-unknown">
          <p className="muted">
            Este número no tiene TAK TAK. Puedes llamarle por teléfono, invitarle a
            instalarla, o buscarle por su @usuario si se registró con correo.
          </p>
          <div className="dialer-unknown-actions">
            <button type="button" className="btn-primary" onClick={callNative}>
              📱 Llamar por teléfono
            </button>
            <button type="button" className="btn-secondary" onClick={invite} disabled={busy}>
              ✉️ Invitar por SMS
            </button>
          </div>
          {unknown.inviteLink && (
            <div className="dialer-invite-link">
              <input readOnly value={unknown.inviteLink} aria-label="Enlace de invitación" />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigator.clipboard?.writeText(unknown.inviteLink)}
              >
                Copiar
              </button>
            </div>
          )}
          {!voiceAvailable && (
            <p className="muted dialer-hint">
              Las videollamadas solo funcionan entre cuentas de TAK TAK: al no tener la
              app, este teléfono no puede recibir el vídeo.
            </p>
          )}
        </div>
      )}

      <div className="dialer-contacts">
        <div className="dialer-contacts-head">
          <span>Contactos del teléfono</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={importContacts}
            disabled={contactsState === 'loading'}
          >
            {contactsState === 'loading' ? 'Leyendo…' : 'Importar'}
          </button>
        </div>

        {contactsState === 'unsupported' && (
          <p className="muted dialer-hint">
            Este navegador no da acceso a la agenda. Escribe el número arriba, o
            añade un contacto a mano aquí abajo.
          </p>
        )}
        {contactsState === 'denied' && (
          <p className="muted dialer-hint">
            No se concedió el permiso de contactos. Puedes añadirlos a mano aquí abajo.
          </p>
        )}
        {contactsState === 'empty' && (
          <p className="muted dialer-hint">No se encontró ningún contacto con teléfono.</p>
        )}

        {/* Camino alternativo a "Importar": cuando el navegador no expone la
            agenda (escritorio, iOS, o permiso denegado) el botón de importar no
            lleva a ninguna parte. Con esto se puede dejar el número guardado a
            mano y llamarlo después, que es lo que el usuario quería hacer. */}
        <form className="dialer-contact-add" onSubmit={addContact}>
          <input
            type="text"
            placeholder="Nombre"
            value={contactDraft.name}
            onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
            aria-label="Nombre del contacto"
          />
          <input
            type="text"
            inputMode="text"
            placeholder="Teléfono o @usuario"
            value={contactDraft.phone}
            onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
            aria-label="Teléfono o usuario del contacto"
          />
          <button
            type="submit"
            className="btn-secondary"
            disabled={!contactDraft.name.trim() || !contactDraft.phone.trim()}
          >
            Añadir
          </button>
        </form>

        {contacts.length > 0 && (
          <ul className="dialer-contacts-list">
            {contacts.map((c) => (
              <li key={`${c.name}-${c.phone}`}>
                <button
                  type="button"
                  className="dialer-contact"
                  onClick={() => {
                    resetResolution();
                    setNumber(c.phone);
                  }}
                >
                  <span className="dialer-contact-name">{c.name}</span>
                  <span className="muted">{c.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
