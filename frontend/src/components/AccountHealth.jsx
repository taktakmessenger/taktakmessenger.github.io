import { useEffect, useState } from 'react';
import api from '../api/client';

const SEVERITY_ICON = { blocked: '⛔', limited: '⚠️', tip: '💡' };

// Account Health: shows exactly what limits reach, and why. The point is that
// nothing is hidden, unlike an opaque "shadowban".
export default function AccountHealth({ onBack }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/health')
      .then(({ data }) => setReport(data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!report) return <div className="centered">Analizando tu cuenta…</div>;

  return (
    <div className="account-health">
      <div className="screen-head">
        {onBack && (
          <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
            ←
          </button>
        )}
        <h2>🔍 Salud de la cuenta</h2>
      </div>
      <p className="muted">{report.policy}</p>

      <div className="wallet-stats">
        <div className="stat-card total">
          <h3>Visibilidad</h3>
          <span className="amount">{report.score}</span>
          <small>{report.visibility}</small>
        </div>
        <div className="stat-card">
          <h3>Shadowban</h3>
          <span className="amount">{report.shadowban ? 'Sí' : 'No'}</span>
        </div>
        <div className="stat-card">
          <h3>Videos</h3>
          <span className="amount">{report.summary.videos}</span>
        </div>
      </div>

      <div className="health-summary">
        <span className="badge">⛔ Bloqueados: {report.summary.blocked}</span>
        <span className="badge">⚠️ Limitados: {report.summary.limited}</span>
        <span className="badge">💡 Consejos: {report.summary.tip}</span>
      </div>

      <div className="health-findings">
        <h3>Detalle</h3>
        {report.findings.length === 0 ? (
          <p className="notice">✅ Sin incidencias. Tu contenido se distribuye con normalidad.</p>
        ) : (
          <ul>
            {report.findings.map((f, i) => (
              <li key={`${f.videoId}-${f.rule}-${i}`} className={`finding ${f.severity}`}>
                <span aria-hidden="true">{SEVERITY_ICON[f.severity] || '•'}</span>
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
