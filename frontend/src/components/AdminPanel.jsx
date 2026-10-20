import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';

export default function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState([]);
  const [ageQueue, setAgeQueue] = useState([]);
  const [claims, setClaims] = useState([]);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [statsRes, videosRes, ageRes, claimsRes, sourcesRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/videos', { params: { status: 'pending' } }),
        api.get('/admin/age-verifications', { params: { status: 'pending' } }),
        api.get('/admin/news-claims'),
        api.get('/admin/news-sources'),
      ]);
      setStats(statsRes.data);
      setPending(videosRes.data.videos);
      setAgeQueue(ageRes.data.users);
      setClaims(claimsRes.data.videos);
      setSources(sourcesRes.data.sources);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  async function runMining() {
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/admin/mining/run');
      setNotice(`Minado ejecutado: ${data.distributed} TTC-R a ${data.recipients} creadores`);
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

      <div className="admin-actions">
        <button type="button" className="btn-secondary" onClick={runMining}>
          ⛏️ Ejecutar ciclo de minado
        </button>
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
