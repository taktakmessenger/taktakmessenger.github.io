import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { copyToClipboard } from '../lib/share';

// Tienda de monedas.
//
// El precio y las monedas los pone el servidor: aquí solo se pintan. Si el
// catálogo estuviera en el cliente, el precio que ve el usuario y el que se
// cobra podrían separarse, y el que manda es el del servidor.
//
// Los botones de cada pasarela solo aparecen si el backend dice que está
// configurada. Ofrecer "Pagar con tarjeta" sin claves sería mandar al usuario a
// una pantalla de pago que no existe.

export default function CoinStore({ onBack, onPurchased, onManageMethods }) {
  const [packages, setPackages] = useState([]);
  const [providers, setProviders] = useState({ stripe: false, paypal: false, manual: false });
  // Métodos de cobro manual (Zinli, pago móvil…): dónde paga el usuario por fuera.
  const [manualMethods, setManualMethods] = useState([]);
  // Métodos guardados: si hay alguno, se ofrece pagar en un toque con él.
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Formulario de cobro manual abierto para un paquete concreto.
  const [manualFor, setManualFor] = useState('');
  const [manualForm, setManualForm] = useState({ method: '', reference: '', note: '' });
  // Qué dato se acaba de copiar, para confirmarlo en el botón ("✅ Copiado").
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    try {
      const [pkgRes, configRes] = await Promise.all([
        api.get('/payments/packages'),
        api.get('/payments/config'),
      ]);
      setPackages(pkgRes.data.packages);
      setProviders(configRes.data.providers);
      setManualMethods(configRes.data.manualMethods || []);

      // La lista de métodos exige sesión. Si falla (visitante sin cuenta), la
      // tienda sigue funcionando: simplemente no hay pago rápido.
      try {
        const methodsRes = await api.get('/payments/methods');
        setMethods(methodsRes.data.methods);
      } catch {
        setMethods([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function buy(provider, packageId) {
    setError('');
    setNotice('');
    setBusy(`${provider}:${packageId}`);
    try {
      const { data } = await api.post('/payments/checkout', { provider, packageId });
      // El pago se completa en la página del proveedor. Al volver, la app abre
      // la pantalla de resultado y el webhook habrá acreditado las monedas.
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  /**
   * Paga con un método guardado.
   *
   * No lleva a ninguna parte: el cobro se hace contra la tarjeta o la cuenta ya
   * registrada. Las monedas no se acreditan aquí, sino cuando la pasarela
   * confirma el cobro, así que se avisa de que pueden tardar unos segundos.
   */
  async function payWithMethod(methodId, packageId) {
    setError('');
    setNotice('');
    setBusy(`saved:${methodId}:${packageId}`);
    try {
      await api.post(`/payments/methods/${methodId}/pay`, { packageId });
      setNotice(
        'Pago enviado con tu método guardado. Las monedas aparecerán en tu monedero en unos segundos.'
      );
      onPurchased?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  /**
   * Envía una orden de cobro manual.
   *
   * No acredita nada: el usuario paga por fuera y envía la referencia, y las
   * monedas llegan cuando un administrador comprueba el ingreso y aprueba. Por
   * eso el aviso dice "en revisión" y no "acreditadas".
   */
  async function submitManual(packageId) {
    setError('');
    setNotice('');
    setBusy(`manual:${packageId}`);
    try {
      await api.post('/payments/manual/orders', {
        packageId,
        method: manualForm.method || manualMethods[0]?.id,
        reference: manualForm.reference,
        note: manualForm.note,
      });
      setNotice(
        'Orden enviada. Cuando se confirme tu pago, las monedas aparecerán en tu monedero.'
      );
      setManualFor('');
      setManualForm({ method: '', reference: '', note: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  /**
   * Copia un dato del método de pago (el enlace o las instrucciones).
   *
   * Se copia al portapapeles porque el usuario tiene que llevárselo a otra app
   * (PayPal, Zinli, su banco). `key` distingue en qué botón confirmar la copia.
   */
  async function copyValue(key, value) {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? '' : current)), 2000);
  }

  const anyProvider = providers.stripe || providers.paypal || providers.manual;

  const selectedManual = manualMethods.find((m) => m.id === (manualForm.method || manualMethods[0]?.id));

  return (
    <div className="coin-store">
      <div className="screen-head">
        {onBack && (
          <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
            ←
          </button>
        )}
        <h2>🪙 Comprar monedas</h2>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <p className="store-hint">
        Las monedas sirven para enviar regalos. El creador recibe el 60% en
        Diamantes retirables. Las monedas de regalo del bono también sirven para
        regalar, pero al creador le llegan como monedas de regalo.
      </p>

      {!anyProvider && !loading && (
        <div className="store-closed" role="status">
          <strong>La tienda está cerrada por ahora</strong>
          <small>
            El cobro todavía no está configurado en el servidor. Los paquetes y
            sus precios ya están listos; falta conectar la pasarela.
          </small>
        </div>
      )}

      {loading ? (
        <p className="centered">Cargando paquetes…</p>
      ) : (
        <ul className="package-list">
          {packages.map((pkg) => (
            <li key={pkg.id} className="package-card">
              <div className="package-info">
                <span className="package-coins">{pkg.coins.toLocaleString('es')} monedas</span>
                <span className="package-price">
                  {pkg.priceUsd.toFixed(2)} USD
                </span>
                <small className="package-rate">
                  {(pkg.priceUsd / pkg.coins).toFixed(4)} USD por moneda
                </small>
              </div>

              <div className="package-actions">
                {/* Pago rápido: si el usuario ya guardó una tarjeta o su PayPal,
                    se ofrece cobrarla en un toque. Va primero porque es lo que
                    menos fricción tiene para quien vuelve a comprar. */}
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="btn-primary saved-pay"
                    disabled={busy === `saved:${m.id}:${pkg.id}`}
                    onClick={() => payWithMethod(m.id, pkg.id)}
                  >
                    {busy === `saved:${m.id}:${pkg.id}`
                      ? 'Cobrando…'
                      : `Pagar con ${m.display}`}
                  </button>
                ))}
                {providers.stripe && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy === `stripe:${pkg.id}`}
                    onClick={() => buy('stripe', pkg.id)}
                  >
                    💳 Tarjeta
                  </button>
                )}
                {providers.paypal && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy === `paypal:${pkg.id}`}
                    onClick={() => buy('paypal', pkg.id)}
                  >
                    🅿️ PayPal
                  </button>
                )}
                {/* Cobro manual: el usuario paga por fuera (Zinli, pago móvil…)
                    y envía la referencia. Va como acción aparte porque no
                    cobra al instante: alguien tiene que confirmar el ingreso. */}
                {providers.manual && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setManualFor(manualFor === pkg.id ? '' : pkg.id)
                    }
                  >
                    📲 Pago manual
                  </button>
                )}
                {!anyProvider && (
                  <button type="button" className="btn-secondary" disabled>
                    No disponible
                  </button>
                )}
              </div>

              {manualFor === pkg.id && providers.manual && (
                <div className="manual-pay">
                  <p className="manual-pay-instructions">
                    {selectedManual?.details ||
                      'Paga el importe por fuera y escribe aquí la referencia del pago.'}
                  </p>
                  {manualMethods.length > 1 && (
                    <select
                      value={manualForm.method || manualMethods[0]?.id}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, method: e.target.value })
                      }
                      aria-label="Método de pago"
                    >
                      {manualMethods.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  )}
                  {/* Enlace directo a la cuenta de cobro: sin esto el usuario
                      tendría que adivinar a quién pagar. Se muestra también
                      como texto y con botón de copiar, porque el usuario suele
                      pagar en otra app (PayPal, Zinli, el banco) y necesita
                      pegar el enlace o la referencia allí. */}
                  {selectedManual?.link && (
                    <div className={selectedManual.blocked ? 'cloud-block' : undefined}>
                      <div className={selectedManual.blocked ? 'cloud-blur' : undefined}>
                        <a
                          className="manual-pay-link"
                          href={selectedManual.blocked ? undefined : selectedManual.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-disabled={selectedManual.blocked || undefined}
                          onClick={(e) => selectedManual.blocked && e.preventDefault()}
                        >
                          👉 Ir a pagar con {selectedManual.label}
                        </a>
                        <div className="manual-pay-copy">
                          <code className="manual-pay-value">{selectedManual.link}</code>
                          <button
                            type="button"
                            className="btn-ghost manual-pay-copy-btn"
                            disabled={selectedManual.blocked}
                            onClick={() =>
                              copyValue(`link:${selectedManual.id}`, selectedManual.link)
                            }
                          >
                            {copied === `link:${selectedManual.id}` ? '✅ Copiado' : '📋 Copiar'}
                          </button>
                        </div>
                      </div>
                      {selectedManual.blocked && <span className="cloud-fog" aria-hidden="true">☁️</span>}
                    </div>
                  )}
                  {/* Pago directo: el correo o la cuenta a la que enviar el
                      dinero sin salir de la app. Se ofrece junto al enlace
                      porque muchos usuarios pagan desde otra app y solo
                      necesitan el dato para pegarlo. */}
                  {selectedManual?.payTo && (
                    <div className={selectedManual.blocked ? 'cloud-block' : undefined}>
                      <div className={`manual-pay-copy${selectedManual.blocked ? ' cloud-blur' : ''}`}>
                        <code className="manual-pay-value">{selectedManual.payTo}</code>
                        <button
                          type="button"
                          className="btn-ghost manual-pay-copy-btn"
                          disabled={selectedManual.blocked}
                          onClick={() =>
                            copyValue(`payTo:${selectedManual.id}`, selectedManual.payTo)
                          }
                        >
                          {copied === `payTo:${selectedManual.id}` ? '✅ Copiado' : '📋 Copiar'}
                        </button>
                      </div>
                      {selectedManual.blocked && <span className="cloud-fog" aria-hidden="true">☁️</span>}
                    </div>
                  )}
                  <input
                    type="text"
                    placeholder="Número de referencia"
                    value={manualForm.reference}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, reference: e.target.value })
                    }
                    aria-label="Número de referencia"
                  />
                  <input
                    type="text"
                    placeholder="Nota (opcional)"
                    value={manualForm.note}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, note: e.target.value })
                    }
                    aria-label="Nota"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!manualForm.reference || busy === `manual:${pkg.id}`}
                    onClick={() => submitManual(pkg.id)}
                  >
                    {busy === `manual:${pkg.id}` ? 'Enviando…' : 'Enviar comprobante'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="store-legal">
        Al comprar aceptas que las monedas no son reembolsables una vez enviadas
        como regalo. La compra en sí sí se puede reembolsar si el pago falla.
      </p>

      {anyProvider && (
        <button type="button" className="btn-link" onClick={onManageMethods}>
          💳 {providers.paypal ? 'Guardar una tarjeta o vincular PayPal' : 'Guardar una tarjeta'}
        </button>
      )}
    </div>
  );
}
