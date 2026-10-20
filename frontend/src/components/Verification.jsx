import { useEffect, useState } from 'react';
import api from '../api/client';

// Age verification panel.
//
// The wording is deliberately plain about what the badge does and does not
// mean. "Verified" here means an identity provider checked an ID document, not
// that the platform has an opinion about the person, and a self-declared date
// of birth is shown separately because it is recorded but proves nothing.
const STATUS_LABEL = {
  unverified: 'Sin verificar',
  pending: 'En revisión',
  verified: 'Verificado',
  rejected: 'Rechazado',
};

export default function Verification() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [declaration, setDeclaration] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceDomains, setSourceDomains] = useState('');
  const [sourceNotice, setSourceNotice] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/verification/age');
      setState(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/verification/age/start');
      // A real provider returns a URL to send the user to. The local dev
      // provider returns none, so the panel just refreshes the status.
      if (data.redirectUrl) {
        window.location.assign(data.redirectUrl);
        return;
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await api.post('/verification/age/refresh');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function declare(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put('/verification/age/declaration', { dateOfBirth: declaration });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function proposeSource(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSourceNotice('');
    try {
      const domains = sourceDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      await api.post('/verification/news-sources', { name: sourceName, domains });
      setSourceNotice('Fuente propuesta. Un revisor la comprobará antes de habilitarla.');
      setSourceName('');
      setSourceDomains('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <div className="centered">Cargando estado de verificación…</div>;
  }

  return (
    <div className="verification">
      <h2>🛡️ Verificación</h2>
      <p className="muted">
        La verificación de edad desbloquea el contenido para adultos y te permite publicarlo.
        Se comprueba con un documento de identidad a través de un proveedor externo.
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="wallet-stats">
        <div className="stat-card total">
          <h3>Estado</h3>
          <span className="amount">{STATUS_LABEL[state.status] || state.status}</span>
          {state.verifiedAt && (
            <small>Verificado el {new Date(state.verifiedAt).toLocaleDateString()}</small>
          )}
        </div>
      </div>

      {state.status !== 'verified' && (
        <div className="wallet-actions">
          <button className="btn-primary" onClick={start} disabled={busy}>
            {state.status === 'pending' ? 'Reiniciar verificación' : 'Verificar mi edad'}
          </button>
          {state.status === 'pending' && (
            <button className="btn-secondary" onClick={refresh} disabled={busy}>
              Ya terminé, comprobar estado
            </button>
          )}
        </div>
      )}

      <form className="verification-declaration" onSubmit={declare}>
        <h3>Fecha de nacimiento</h3>
        <p className="muted">
          Se guarda para tu experiencia, pero <strong>no</strong> cuenta como verificación.
        </p>
        <div className="verification-row">
          <input
            type="date"
            value={declaration}
            onChange={(e) => setDeclaration(e.target.value)}
            required
          />
          <button type="submit" className="btn-secondary" disabled={busy || !declaration}>
            Guardar
          </button>
        </div>
      </form>

      <form className="verification-declaration" onSubmit={proposeSource}>
        <h3>Proponer una fuente de noticias</h3>
        <p className="muted">
          Si publicas noticias de un medio que aún no está en la lista, propónlo.
          Un revisor comprobará el dominio antes de habilitarlo.
        </p>
        {sourceNotice && <p className="notice" role="status">{sourceNotice}</p>}
        <div className="verification-row">
          <input
            type="text"
            placeholder="Nombre del medio"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Dominios separados por coma (ej. medio.com, www.medio.com)"
            value={sourceDomains}
            onChange={(e) => setSourceDomains(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={busy || !sourceName}>
            Proponer
          </button>
        </div>
      </form>
    </div>
  );
}
