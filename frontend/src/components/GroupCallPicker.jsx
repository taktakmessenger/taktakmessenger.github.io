import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { GROUP_CALL_MAX } from '../lib/groupCall';

function initials(person) {
  const name = person?.displayName || person?.username || '?';
  return name.slice(0, 2).toUpperCase();
}

/**
 * Selector de personas para una llamada grupal ad-hoc.
 *
 * Solo se puede invitar a quien ya tienes en tus chats: no es un directorio
 * abierto. Se cargan las conversaciones y se deja marcar a las personas. El tope
 * es `GROUP_CALL_MAX - 1` porque quien llama ocupa una plaza.
 */
export default function GroupCallPicker({ onStart, onClose, kind = 'video' }) {
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const limit = GROUP_CALL_MAX - 1;

  useEffect(() => {
    let active = true;
    api
      .get('/messages/conversations')
      .then(({ data }) => {
        if (!active) return;
        const list = (data.conversations || [])
          .map((c) => c.with?.[0])
          .filter((p) => p && (p.id || p._id));
        setPeople(list);
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(() => {
    const term = query.trim().replace(/^@/, '').toLowerCase();
    if (!term) return people;
    return people.filter((p) =>
      `${p.username || ''} ${p.displayName || ''}`.toLowerCase().includes(term)
    );
  }, [people, query]);

  function toggle(person) {
    const id = String(person.id || person._id);
    setSelected((prev) => {
      if (prev.some((p) => String(p.id || p._id) === id)) {
        return prev.filter((p) => String(p.id || p._id) !== id);
      }
      if (prev.length >= limit) {
        setError(`Una llamada admite ${GROUP_CALL_MAX} personas como máximo`);
        return prev;
      }
      setError('');
      return [...prev, person];
    });
  }

  async function start() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await onStart(selected, kind);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="groupcall-picker" role="dialog" aria-label="Nueva llamada grupal">
      <div className="groupcall-picker-head">
        <button type="button" className="groupcall-picker-back" onClick={onClose} aria-label="Cerrar">
          ✖
        </button>
        <strong>Llamada grupal</strong>
        <span className="groupcall-picker-count">
          {selected.length}/{limit}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="groupcall-chosen">
          {selected.map((p) => (
            <button
              type="button"
              key={p.id || p._id}
              className="groupcall-chip"
              onClick={() => toggle(p)}
              aria-label={`Quitar a @${p.username}`}
            >
              <span className="avatar">{initials(p)}</span>
              <span>@{p.username}</span>
              <span aria-hidden="true">✖</span>
            </button>
          ))}
        </div>
      )}

      <input
        type="search"
        className="inbox-search"
        placeholder="Buscar en tus chats"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar personas"
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="muted">No tienes chats con quien llamar todavía.</p>
      ) : (
        <ul className="groupcall-people">
          {visible.map((p) => {
            const id = String(p.id || p._id);
            const on = selected.some((s) => String(s.id || s._id) === id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`groupcall-person ${on ? 'on' : ''}`}
                  onClick={() => toggle(p)}
                >
                  <span className="avatar">{initials(p)}</span>
                  <span className="groupcall-person-name">
                    <strong>{p.displayName || `@${p.username}`}</strong>
                    <small>@{p.username}</small>
                  </span>
                  <span className="groupcall-check" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="groupcall-picker-foot">
        <button
          type="button"
          className="btn-primary"
          onClick={start}
          disabled={busy || selected.length === 0}
        >
          {busy ? 'Llamando…' : `Llamar (${selected.length})`}
        </button>
      </div>
    </div>
  );
}
