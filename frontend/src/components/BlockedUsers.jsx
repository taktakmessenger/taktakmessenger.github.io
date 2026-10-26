import { useEffect, useState } from 'react';
import api from '../api/client';

// Cuentas bloqueadas, con la opción de desbloquear.
//
// Bloquear sin poder desbloquear no es una función de seguridad, es una trampa:
// quien bloquea por error (o cambia de idea) se queda sin forma de arreglarlo, y
// la alternativa sería pedirle a soporte que lo haga a mano. Es reversible por
// diseño, y esta es la pantalla que lo hace.
export default function BlockedUsers({ onBack }) {
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .get('/safety/blocked')
      .then(({ data }) => {
        if (active) setBlocked(Array.isArray(data?.blocked) ? data.blocked : []);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function unblock(person) {
    setBusyId(person.id);
    setError('');
    try {
      await api.delete(`/safety/block/${person.id}`);
      // Se retira de la lista al confirmar el servidor, no antes: si falla, la
      // persona sigue ahí y el usuario no cree que la desbloqueó en vano.
      setBlocked((prev) => prev.filter((p) => p.id !== person.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="settings">
      <div className="screen-head">
        <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h2>Cuentas bloqueadas</h2>
      </div>

      <p className="settings-hint">
        Estas personas no pueden escribirte, llamarte ni ver tus contenidos, y tú no ves los
        suyos. Desbloquear no las vuelve a seguir: eso hay que hacerlo aparte.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : blocked.length === 0 ? (
        <p className="muted">No has bloqueado a nadie.</p>
      ) : (
        <ul className="blocked-list">
          {blocked.map((person) => (
            <li key={person.id} className="blocked-item">
              <span className="avatar">{(person.username || '?').slice(0, 2).toUpperCase()}</span>
              <span className="blocked-id">
                <strong>{person.displayName || `@${person.username}`}</strong>
                <small className="muted">@{person.username}</small>
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => unblock(person)}
                disabled={busyId === person.id}
              >
                {busyId === person.id ? '…' : 'Desbloquear'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
