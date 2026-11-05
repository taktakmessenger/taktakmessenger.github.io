import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { BackIcon } from './ChatIcons';
import glenisIa from '../assets/glenis-ia.jpg';

export default function AdminPanel({ onBack }) {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState([]);
  const [ageQueue, setAgeQueue] = useState([]);
  const [claims, setClaims] = useState([]);
  const [sources, setSources] = useState([]);
  const [reports, setReports] = useState([]);
  const [manualOrders, setManualOrders] = useState([]);
  const [salesSummary, setSalesSummary] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [suggestions, setSuggestions] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [reportFilter, setReportFilter] = useState('open');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Cartera del administrador: es el único que puede convertir Monedas en
  // Diamantes retirables. Se pide junto al resto del panel.
  const [adminWallet, setAdminWallet] = useState(null);
  const [convertRate, setConvertRate] = useState(1);
  const [convertAmount, setConvertAmount] = useState('');
  const [converting, setConverting] = useState(false);

  // Asistente del administrador. El historial vive en el servidor (uno por
  // administrador), así que aquí solo se guarda el mensaje nuevo; al montar el
  // panel se pide el hilo para que reaparezca tras recargar o cambiar de móvil.
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const loadChat = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/assistant');
      setChatMessages(data.messages || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  const load = useCallback(async () => {
    try {
      const [statsRes, videosRes, ageRes, claimsRes, sourcesRes, reportsRes, manualRes, withdrawalsRes, summaryRes, walletRes] =
        await Promise.all([
          api.get('/admin/stats'),
          api.get('/admin/videos', { params: { status: 'pending' } }),
          api.get('/admin/age-verifications', { params: { status: 'pending' } }),
          api.get('/admin/news-claims'),
          api.get('/admin/news-sources'),
          api.get('/admin/reports', { params: { status: reportFilter } }),
          api.get('/admin/manual-orders', { params: { status: 'pending' } }),
          api.get('/admin/withdrawals', { params: { status: 'pending' } }),
          api.get('/admin/manual-orders/summary'),
          api.get('/admin/wallet'),
        ]);
      setStats(statsRes.data);
      setPending(videosRes.data.videos);
      setAgeQueue(ageRes.data.users);
      setClaims(claimsRes.data.videos);
      setSources(sourcesRes.data.sources);
      setReports(reportsRes.data.reports);
      setManualOrders(manualRes.data.orders);
      setWithdrawals(withdrawalsRes.data.withdrawals);
      setSalesSummary(summaryRes.data);
      setAdminWallet(walletRes.data.wallet);
      setConvertRate(walletRes.data.rate || 1);
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

  // Reencola la conversión de los vídeos que se quedaron sin HLS. Es la forma de
  // arreglar de golpe los vídeos subidos antes de activar la transcodificación.
  async function optimizeMissing() {
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/videos/optimize-missing');
      setNotice(
        data.queued > 0
          ? `Optimizando ${data.queued} de ${data.total} vídeos sin HLS…`
          : 'No hay vídeos pendientes de optimizar.'
      );
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

  async function decideManual(id, approve) {
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(
        `/admin/manual-orders/${id}/${approve ? 'approve' : 'reject'}`,
        approve ? {} : { reason: 'Pago no encontrado' }
      );
      setNotice(
        approve
          ? `Orden aprobada: ${data.coins} monedas acreditadas`
          : 'Orden rechazada'
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Resuelve un retiro: pagar solo lo marca (el saldo ya se descontó al
  // solicitarlo), rechazar devuelve los Diamantes. El pago real lo hace el
  // administrador por fuera (PayPal, Zelle…); aquí queda el registro.
  async function decideWithdrawal(id, pay) {
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(
        `/admin/withdrawals/${id}/${pay ? 'pay' : 'reject'}`,
        pay ? {} : { reason: 'Datos de cobro incorrectos' }
      );
      setNotice(
        pay
          ? `Retiro marcado como pagado (${data.amount} Diamantes)`
          : `Retiro rechazado: ${data.amount} Diamantes devueltos`
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  // Envía un turno al asistente. Solo se manda el mensaje nuevo: el historial
  // lo guarda el servidor por administrador, así que la conversación no depende
  // de esta pestaña. Al volver, se añade la respuesta y se recargan los datos
  // del panel, ya que el asistente pudo haber cambiado algo (aprobado un vídeo,
  // acreditado monedas) y las listas deben reflejarlo.
  async function sendChat(e) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatBusy) return;

    setChatMessages((prev) => [...prev, { role: 'user', content: text }]);
    setChatInput('');
    setChatBusy(true);
    setError('');
    try {
      const { data } = await api.post('/admin/assistant', { message: text });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.executed?.length) await load();
    } catch (err) {
      setError(err.message);
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `No pude responder: ${err.message}` },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  // Limpiar borra el hilo en el servidor, no solo la pantalla: si solo se
  // vaciara aquí, al recargar volvería todo y el asistente seguiría recordando.
  async function clearChat() {
    if (chatBusy) return;
    try {
      await api.delete('/admin/assistant');
      setChatMessages([]);
    } catch (err) {
      setError(err.message);
    }
  }

  // Convierte Monedas propias en Diamantes retirables. Es exclusivo del
  // administrador: el servidor rechaza la petición para cualquier otra cuenta.
  async function handleConvert(e) {
    e.preventDefault();
    const coins = Number(convertAmount);
    if (!Number.isFinite(coins) || coins <= 0 || converting) return;
    setError('');
    setNotice('');
    setConverting(true);
    try {
      const { data } = await api.post('/admin/wallet/convert', { coins });
      setNotice(data.message);
      setConvertAmount('');
      setAdminWallet(data.wallet);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setConverting(false);
    }
  }

  // Pide al asistente que revise las pendientes. Solo trae sugerencias: no
  // aprueba nada, eso lo decide el administrador con el botón de cada orden.
  async function runAssistantReview() {
    setError('');
    setNotice('');
    setReviewing(true);
    try {
      const { data } = await api.get('/admin/manual-orders/review');
      const map = {};
      for (const item of data.reviewed) map[item.orderId] = item;
      setSuggestions(map);
      if (!data.configured) {
        setNotice('El asistente no está configurado (falta ASSISTANT_API_KEY).');
      } else {
        setNotice(`El asistente revisó ${data.reviewed.length} órdenes.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="admin">
      <div className="screen-head">
        {onBack && (
          <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
            <BackIcon />
          </button>
        )}
        <h2>🛡️ Panel de administración</h2>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {stats && (
        <div className="wallet-stats">
          <div className="stat-card"><h3>Usuarios</h3><span className="amount">{stats.users}</span></div>
          <div className="stat-card"><h3>Videos</h3><span className="amount">{stats.videos}</span></div>
          <div className="stat-card"><h3>Pendientes</h3><span className="amount">{stats.pendingVideos}</span></div>
          <div className="stat-card"><h3>Transacciones</h3><span className="amount">{stats.transactions}</span></div>
          <div className="stat-card total">
            <h3>Ingresos ({Math.round((stats.platformShare ?? 0.4) * 100)}%)</h3>
            <span className="amount">{Number(stats.platformEarnings ?? 0).toFixed(2)}</span>
            <small>{stats.giftsProcessed ?? 0} regalos</small>
          </div>
        </div>
      )}

      {/* Asistente del administrador. Solo aparece aquí, detrás de la sesión de
          admin: no hay forma de llegar a él con una cuenta normal. */}
      <div className="moderation admin-assistant">
        <div className="admin-section-head">
          <div className="glenis-head">
            <span className="glenis-avatar">
              <img src={glenisIa} alt="GLENIS IA" />
            </span>
            <div className="glenis-id">
              <h3>GLENIS IA</h3>
              <span className="glenis-role">Asistente del administrador</span>
            </div>
          </div>
          {chatMessages.length > 0 && (
            <button
              type="button"
              className="btn-link"
              onClick={clearChat}
              disabled={chatBusy}
            >
              Limpiar
            </button>
          )}
        </div>
        <p className="hint">
          Pídele tareas en lenguaje natural: «busca al usuario elidep», «qué vídeos hay
          pendientes», «aprueba el vídeo …», «acredita 500 monedas a …». Puede consultar y
          ejecutar acciones reales. Recuerda la conversación, así que puedes seguir donde
          lo dejaste aunque cierres el panel o entres desde otro móvil.
        </p>

        {chatMessages.length > 0 && (
          <div className="admin-chat-log">
            {chatMessages.map((m, i) => (
              <div key={i} className={`admin-chat-msg ${m.role}`}>
                <strong>{m.role === 'user' ? 'Tú' : 'GLENIS IA'}</strong>
                <p>{m.content}</p>
              </div>
            ))}
            {chatBusy && <p className="hint">Pensando…</p>}
          </div>
        )}

        <form className="admin-chat-form" onSubmit={sendChat}>
          <input
            type="text"
            placeholder="Escribe una instrucción…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatBusy}
          />
          <button type="submit" className="btn-primary" disabled={chatBusy || !chatInput.trim()}>
            {chatBusy ? '…' : 'Enviar'}
          </button>
        </form>
      </div>

      {/* Resumen de ventas de monedas: cuánto entró y quiénes compraron. Es la
          vista que responde "¿cuántos usuarios compran monedas?" sin tener que
          recorrer orden por orden. */}
      <div className="moderation">
        <div className="admin-section-head">
          <h3>Ventas de monedas</h3>
        </div>
        {!salesSummary || salesSummary.ordenes === 0 ? (
          <p>Todavía no hay compras de monedas registradas.</p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-card"><h3>Órdenes</h3><span className="amount">{salesSummary.ordenes}</span></div>
              <div className="stat-card"><h3>Monedas vendidas</h3><span className="amount">{salesSummary.monedas.toLocaleString('es')}</span></div>
              <div className="stat-card"><h3>Total cobrado</h3><span className="amount">{salesSummary.usd.toFixed(2)} USD</span></div>
              <div className="stat-card"><h3>Compradores</h3><span className="amount">{salesSummary.compradores.length}</span></div>
            </div>
            {salesSummary.compradores.length > 0 && (
              <ul>
                {salesSummary.compradores.map((c) => (
                  <li key={c.usuario} className="moderation-item">
                    <div>
                      <strong>@{c.usuario}</strong>
                      <small>
                        {c.ordenes} compra{c.ordenes === 1 ? '' : 's'} · {c.monedas.toLocaleString('es')} monedas · {c.usd.toFixed(2)} USD
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Cobro manual: el administrador comprueba el ingreso por fuera y
          aprueba. Aprobar acredita las monedas de verdad. */}
      <div className="moderation">
        <div className="admin-section-head">
          <h3>Pagos manuales por revisar ({manualOrders.length})</h3>
          <button
            type="button"
            className="btn-secondary"
            disabled={reviewing || manualOrders.length === 0}
            onClick={runAssistantReview}
          >
            {reviewing ? 'Revisando…' : '🤖 Revisar con asistente'}
          </button>
        </div>
        {manualOrders.length === 0 ? (
          <p>No hay pagos pendientes de revisión.</p>
        ) : (
          <ul>
            {manualOrders.map((o) => {
              const review = suggestions[o._id];
              const suggestion = review?.suggestion;
              return (
                <li key={o._id} className="moderation-item">
                  <div>
                    <strong>
                      {o.coins.toLocaleString('es')} monedas · {o.priceUsd.toFixed(2)} USD · {o.method}
                    </strong>
                    <small>
                      @{o.user?.username || 'desconocido'} · ref. {o.reference}
                      {o.note ? ` · “${o.note}”` : ''}
                    </small>
                    {/* Sugerencia del asistente. Es una ayuda para decidir, no
                        una decisión: el botón que acredita sigue siendo el de
                        abajo, y solo lo pulsa una persona. */}
                    {suggestion && (
                      <small className={`assistant-hint ${suggestion.action}`}>
                        🤖 {suggestion.action === 'approve' ? 'Sugiere aprobar' : suggestion.action === 'reject' ? 'Sugiere rechazar' : 'Duda'}
                        {' '}({Math.round(suggestion.confidence * 100)}%): {suggestion.reason}
                      </small>
                    )}
                  </div>
                  <div className="moderation-buttons">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => decideManual(o._id, true)}
                    >
                      Aprobar y acreditar
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => decideManual(o._id, false)}
                    >
                      Rechazar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Cartera del administrador: convertir Monedas en Diamantes retirables.
          Es la única cuenta que puede hacerlo; el servidor lo exige. */}
      {adminWallet && (
        <div className="moderation">
          <div className="admin-section-head">
            <h3>💎 Convertir Monedas en Diamantes</h3>
          </div>
          <p className="hint">
            Solo tú puedes hacer esta conversión. Tienes{' '}
            <strong>{Number(adminWallet.coins || 0).toFixed(2)}</strong> Monedas y{' '}
            <strong>{Number(adminWallet.diamonds || 0).toFixed(2)}</strong> Diamantes.
            Tasa: 1 Moneda = {convertRate} Diamante{convertRate === 1 ? '' : 's'}.
          </p>
          <form className="admin-chat-form" onSubmit={handleConvert}>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="Monedas a convertir"
              value={convertAmount}
              onChange={(e) => setConvertAmount(e.target.value)}
              disabled={converting}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={converting || !(Number(convertAmount) > 0)}
            >
              {converting ? '…' : 'Convertir'}
            </button>
          </form>
        </div>
      )}

      {/* Retiros de Diamantes: aquí el administrador comprueba la cuenta de
          cobro, paga por fuera y lo marca. Rechazar devuelve los Diamantes. */}
      <div className="moderation">
        <div className="admin-section-head">
          <h3>Retiros pendientes ({withdrawals.length})</h3>
        </div>
        {withdrawals.length === 0 ? (
          <p>No hay retiros pendientes de pago.</p>
        ) : (
          <ul>
            {withdrawals.map((w) => (
              <li key={w.id} className="moderation-item">
                <div>
                  <strong>
                    {w.amount} Diamantes · {w.method}
                  </strong>
                  <small>
                    @{w.user?.username || 'desconocido'}
                    {w.user?.displayName ? ` (${w.user.displayName})` : ''} · {w.details}
                  </small>
                  <small>{new Date(w.createdAt).toLocaleString()}</small>
                </div>
                <div className="moderation-buttons">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => decideWithdrawal(w.id, true)}
                  >
                    Marcar como pagado
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => decideWithdrawal(w.id, false)}
                  >
                    Rechazar y devolver
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
        <div className="admin-section-head">
          <h3>Cola de moderación ({pending.length})</h3>
          <button type="button" className="btn-ghost" onClick={optimizeMissing}>
            ⚙️ Optimizar vídeos sin HLS
          </button>
        </div>
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
