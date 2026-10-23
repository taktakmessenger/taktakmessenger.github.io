import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';

// Tienda de monedas.
//
// El precio y las monedas los pone el servidor: aquí solo se pintan. Si el
// catálogo estuviera en el cliente, el precio que ve el usuario y el que se
// cobra podrían separarse, y el que manda es el del servidor.
//
// Los botones de cada pasarela solo aparecen si el backend dice que está
// configurada. Ofrecer "Pagar con tarjeta" sin claves sería mandar al usuario a
// una pantalla de pago que no existe.

export default function CoinStore({ onBack, onPurchased }) {
  const [packages, setPackages] = useState([]);
  const [providers, setProviders] = useState({ stripe: false, paypal: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [pkgRes, configRes] = await Promise.all([
        api.get('/payments/packages'),
        api.get('/payments/config'),
      ]);
      setPackages(pkgRes.data.packages);
      setProviders(configRes.data.providers);
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

  const anyProvider = providers.stripe || providers.paypal;

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
                {!anyProvider && (
                  <button type="button" className="btn-secondary" disabled>
                    No disponible
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="store-legal">
        Al comprar aceptas que las monedas no son reembolsables una vez enviadas
        como regalo. La compra en sí sí se puede reembolsar si el pago falla.
      </p>
    </div>
  );
}
