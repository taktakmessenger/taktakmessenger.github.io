import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';

export default function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState([]);
  const [ageQueue, setAgeQueue] = useState([]);
  const [claims, setClaims] = useState([]);
  const [sources, setSources] = useState([]);
  const [reports, setReports] = useState([]);
  const [reportFilter, setReportFilter] = useState('open');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [statsRes, videosRes, ageRes, claimsRes, sourcesRes, reportsRes] =
        await Promise.all([
          api.get('/admin/stats'),
          api.get('/admin/videos', { params: { status: 'pending' } }),
          api.get('/admin/age-verifications', { params: { status: 'pending' } }),
          api.get('/admin/news-claims'),
          api.get('/admin/news-sources'),
          api.get('/admin/reports', { params: { status: reportFilter } }),
        ]);
      setStats(statsRes.data);
      setPending(videosRes.data.videos);
      setAgeQueue(ageRes.data.users);
      setClaims(claimsRes.data.videos);
      setSources(sourcesRes.data.sources);
      setReports(reportsRes.data.reports);
    } catch (err) {
      setError(err.message);
    }
  }, [reportFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Al resolver un reporte se recarga la lista para que desaparezca del filtro
  // activo (si se está mirando "abiertos"), en vez de dejarlo ahí ya resuelto.
  async function resolveReport(id, status) {
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/reports/${id}`, { status });
      setNotice(
        status === 'actioned'
          ? 'Reporte atendido: se tomaron medidas'
          : 'Reporte descartado'
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function moderate(id, status) {
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/videos/${id}/moderate`, { status });
      setNotice(`Video ${status === 'approved' ? 'aprobado' : 'rechazado'}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function decideAge(id, status) {
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/age-verifications/${id}`, { status });
      setNotice(`Verificación de edad: ${status}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setSourceStatus(id, status) {
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/news-sources/${id}`, { status });
      setNotice(`Fuente ${status === 'verified' ? 'verificada' : 'revocada'}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function decideBadge(id, approve) {
    setError('');
    setNotice('');
    try {
      await api.post(`/admin/news-claims/${id}/${approve ? 'approve' : 'revoke'}`);
      setNotice(approve ? 'Sello de noticia concedido' : 'Sello retirado');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="admin">
      <h2>🛡️ Panel de administración</h2>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {stats && (
        <div className="wallet-stats">
          <div className="stat-card"><h3>Usuarios</h3><span className="amount">{stats.users}</span></div>
          <div className="stat-card"><h3>Videos</h3><span className="amount">{stats.videos}</span></div>
          <div className="stat-card"><h3>Pendientes</h3><span className="amount">{stats.pendingVideos}</span></div>
          <div className="stat-card"><h3>Transacciones</h3><span className="amount">{stats.transactions}</span></div>
          <div className="stat-card total">
            <h3>Ingresos (25%)</h3>
            <span className="amount">{Number(stats.platformEarnings ?? 0).toFixed(2)}</span>
            <small>{stats.giftsProcessed ?? 0} regalos</small>
          </div>
        </div>
      )}

      {/* La cola de reportes va primero, después de las cifras: es lo que un
          moderador abre a mirar. Antes los reportes de los usuarios no llegaban
          a ninguna parte. */}
      <div className="moderation">
        <div className="admin-section-head">
          <h3>Reportes ({reports.length})</h3>
          <div className="admin-filters">
            {[
              { id: 'open', label: 'Abiertos' },
              { id: 'reviewing', label: 'En revisión' },
              { id: 'actioned', label: 'Atendidos' },
              { id: 'dismissed', label: 'Descartados' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`explore-tab ${reportFilter === f.id ? 'active' : ''}`}
                onClick={() => setReportFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {reports.length === 0 ? (
          <p>No hay reportes en este estado.</p>
        ) : (
          <ul>
            {reports.map((r) => (
              <li key={r.id} className="moderation-item">
                <div>
                  <strong>
                    {r.reason} · {r.targetType}
                  </strong>
                  <small>
                    {r.target?.preview ? `“${r.target.preview}” · ` : ''}
                    {r.target?.owner ? `@${r.target.owner.username} · ` : ''}
                    reportado por @{r.reporter?.username || 'desconocido'}
                    {r.details ? ` · “${r.details}”` : ''}
                  </small>
                  {!r.target && <small className="muted">El contenido ya no existe.</small>}
                </div>
                <div className="moderation-buttons">
                  {r.status !== 'reviewing' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => resolveReport(r.id, 'reviewing')}
                    >
                      En revisión
                    </button>
                  )}
                  {r.status !== 'actioned' && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => resolveReport(r.id, 'actioned')}
                    >
                      Actuar
                    </button>
                  )}
                  {r.status !== 'dismissed' && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => resolveReport(r.id, 'dismissed')}
                    >
                      Descartar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="moderation">
        <h3>Cola de moderación ({pending.length})</h3>
        {pending.length === 0 ? (
          <p>No hay videos pendientes.</p>
        ) : (
          <ul>
            {pending.map((v) => (
              <li key={v._id} className="moderation-item">
                <div>
                  <strong>{v.title}</strong>
                  <small>@{v.creator?.username}</small>
                </div>
                <div className="moderation-buttons">
                  <button type="button" className="btn-primary" onClick={() => moderate(v._id, 'approved')}>
                    Aprobar
                  </button>
                  <button type="button" className="btn-danger" onClick={() => moderate(v._id, 'rejected')}>
                    Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="moderation">
        <h3>Verificaciones de edad pendientes ({ageQueue.length})</h3>
        {ageQueue.length === 0 ? (
          <p>No hay verificaciones pendientes.</p>
        ) : (
          <ul>
            {ageQueue.map((u) => (
              <li key={u._id} className="moderation-item">
                <div>
                  <strong>@{u.username}</strong>
                  <small>{u.email}</small>
                </div>
                <div className="moderation-buttons">
                  <button type="button" className="btn-primary" onClick={() => decideAge(u._id, 'verified')}>
                    Verificar
                  </button>
                  <button type="button" className="btn-danger" onClick={() => decideAge(u._id, 'rejected')}>
                    Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="moderation">
        <h3>Fuentes de noticias ({sources.length})</h3>
        {sources.length === 0 ? (
          <p>No hay fuentes registradas.</p>
        ) : (
          <ul>
            {sources.map((s) => (
              <li key={s._id} className="moderation-item">
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.domains?.join(', ') || 'sin dominios'} · {s.status}</small>
                </div>
                <div className="moderation-buttons">
                  {s.status !== 'verified' && (
                    <button type="button" className="btn-primary" onClick={() => setSourceStatus(s._id, 'verified')}>
                      Verificar
                    </button>
                  )}
                  {s.status === 'verified' && (
                    <button type="button" className="btn-danger" onClick={() => setSourceStatus(s._id, 'revoked')}>
                      Revocar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="moderation">
        <h3>Noticias por revisar ({claims.length})</h3>
        {claims.length === 0 ? (
          <p>No hay noticias por revisar.</p>
        ) : (
          <ul>
            {claims.map((v) => (
              <li key={v._id} className="moderation-item">
                <div>
                  <strong>{v.title}</strong>
                  <small>
                    @{v.creator?.username} · {v.newsSource?.name || 'sin fuente'}
                    {v.newsVerified ? ' · ya verificado' : ''}
                  </small>
                </div>
                <div className="moderation-buttons">
                  {!v.newsVerified && (
                    <button type="button" className="btn-primary" onClick={() => decideBadge(v._id, true)}>
                      Conceder sello
                    </button>
                  )}
                  {v.newsVerified && (
                    <button type="button" className="btn-danger" onClick={() => decideBadge(v._id, false)}>
                      Retirar sello
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
