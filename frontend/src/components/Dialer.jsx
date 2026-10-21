import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

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

  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  // La lista de países sale de libphonenumber en el servidor, así que cubre
  // todos los territorios y los prefijos están al día.
  useEffect(() => {
    api
      .get('/auth/providers')
      .then(({ data }) => {
        const list = Array.isArray(data?.countries) ? data.countries : [];
        setCountries(list);
        // Preselecciona el país del navegador si está en la lista, para no
        // obligar a buscarlo cada vez. Si no coincide, se queda sin país y el
        // usuario escribe el prefijo internacional.
        const guessed = navigator.language?.split('-')[1];
        const match = list.find((c) => c.code === guessed);
        if (match) setCountry(match);
      })
      .catch(() => {});
  }, []);

  function append(char) {
    setResolved(null);
    setStatus('Listo para llamar');
    setNumber((prev) => prev + char);
  }

  function backspace() {
    setResolved(null);
    setStatus('Listo para llamar');
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase() === q
    );
  }, [countries, search]);

  // Resuelve el número a una cuenta y lanza la llamada. Se resuelve en el
  // servidor porque el cliente no puede saber a quién pertenece un teléfono, y
  // no debe: la búsqueda va autenticada y limitada.
  async function call() {
    const digits = number.trim();
    if (!digits || busy) return;

    setBusy(true);
    setStatus('Buscando el número…');
    setResolved(null);

    try {
      const { data } = await api.post('/users/lookup-phone', {
        phone: digits,
        country: country?.code,
      });
      const user = data.user;
      setResolved(user);
      setStatus(`Llamando a @${user.username}…`);
      onCall?.(user, 'audio');
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
          type="tel"
          inputMode="tel"
          className="dialer-number"
          placeholder="Número de teléfono"
          value={number}
          onChange={(e) => {
            setResolved(null);
            setStatus('Listo para llamar');
            setNumber(e.target.value);
          }}
          aria-label="Número de teléfono"
        />
      </div>

      {pickerOpen && (
        <div className="dialer-picker">
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
          onClick={call}
          disabled={!number.trim() || busy}
          aria-label="Llamar"
        >
          📞
        </button>
        <button
          type="button"
          className="dialer-clear"
          onClick={() => {
            setNumber('');
            setResolved(null);
            setStatus('Listo para llamar');
          }}
          aria-label="Limpiar"
          disabled={!number}
        >
          ✖
        </button>
      </div>

      {resolved && (
        <div className="dialer-resolved">
          <span className="muted">Encontrado</span>
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
    </div>
  );
}
