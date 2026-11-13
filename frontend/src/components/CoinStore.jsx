import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import WalletPay from './WalletPay';

// Tienda de monedas.
//
// El precio y las monedas los pone el servidor: aquí solo se pintan. Si el
// catálogo estuviera en el cliente, el precio que ve el usuario y el que se
// cobra podrían separarse, y el que manda es el del servidor.
//
// El cobro es SOLO por billetera cripto (USDT en BNB Smart Chain). No hay
// pasarelas ni métodos antiguos: una sola vía, sin cuenta de empresa, sin
// webhooks y sin intermediarios. El usuario paga desde su wallet y pega el hash;
// el sistema lo comprueba.

// Un método es "billetera" cuando trae moneda, red y dirección. Los tres juntos
// son lo que hace falta para poder pagar sin preguntar nada más.
function isWallet(m) {
  return Boolean(m.asset && m.network && m.payTo);
}

export default function CoinStore({ onBack, onPurchased }) {
  const [packages, setPackages] = useState([]);
  const [providers, setProviders] = useState({ manual: false });
  // Métodos de cobro: solo billeteras cripto (USDT). El cobro con pasarelas y
  // los métodos antiguos se retiraron a propósito: una sola vía de pago, sin
  // cuentas de empresa ni intermediarios.
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Qué paquete y método tiene abierto el formulario de pago.
  const [payFor, setPayFor] = useState(null); // { packageId, methodId }
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [pkgRes, configRes] = await Promise.all([
        api.get('/payments/packages'),
        api.get('/payments/config'),
      ]);
      setPackages(pkgRes.data.packages);
      setProviders(configRes.data.providers);
      const all = configRes.data.manualMethods || [];
      setWallets(all.filter(isWallet));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openPay(packageId, methodId) {
    setError('');
    setNotice('');
    setReference('');
    setNote('');
    setPayFor(
      payFor?.packageId === packageId && payFor?.methodId === methodId
        ? null
        : { packageId, methodId }
    );
  }

  /**
   * Envía una orden de cobro.
   *
   * No acredita nada: el usuario paga por fuera (desde su wallet o su cuenta) y
   * envía la referencia. Las monedas llegan cuando un administrador comprueba el
   * ingreso y aprueba, así que el aviso dice "en revisión", no "acreditadas".
   */
  async function submit(packageId, methodId) {
    setError('');
    setNotice('');
    setBusy(`pay:${packageId}`);
    try {
      await api.post('/payments/manual/orders', {
        packageId,
        method: methodId,
        reference,
        note,
      });
      setNotice(
        'Orden enviada. Cuando se confirme tu pago, las monedas aparecerán en tu monedero.'
      );
      setPayFor(null);
      setReference('');
      setNote('');
      onPurchased?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const anyMethod = wallets.length > 0;

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

      {!anyMethod && !loading && (
        <div className="store-closed" role="status">
          <strong>La tienda está cerrada por ahora</strong>
          <small>
            El cobro todavía no está configurado en el servidor. Los paquetes y
            sus precios ya están listos; falta declarar la billetera de cobro.
          </small>
        </div>
      )}

      {loading ? (
        <p className="centered">Cargando paquetes…</p>
      ) : (
        <ul className="package-list">
          {packages.map((pkg) => {
            const open = payFor?.packageId === pkg.id ? payFor.methodId : null;
            const openWallet = wallets.find((m) => m.id === open);
            return (
              <li key={pkg.id} className="package-card">
                <div className="package-info">
                  <span className="package-coins">{pkg.coins.toLocaleString('es')} monedas</span>
                  <span className="package-price">{pkg.priceUsd.toFixed(2)} USD</span>
                  <small className="package-rate">
                    {(pkg.priceUsd / pkg.coins).toFixed(4)} USD por moneda
                  </small>
                </div>

                <div className="package-actions">
                  {/* Billeteras primero: es la vía preferida y la que menos
                      fricción tiene para quien ya usa cripto. */}
                  {wallets.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="btn-primary wallet-pay-btn"
                      onClick={() => openPay(pkg.id, m.id)}
                    >
                      🪙 Pagar con {m.asset} ({m.network})
                    </button>
                  ))}
                </div>

                {openWallet && (
                  <WalletPay
                    method={openWallet}
                    priceUsd={pkg.priceUsd}
                    reference={reference}
                    onReference={setReference}
                    onSubmit={() => submit(pkg.id, openWallet.id)}
                    busy={busy === `pay:${pkg.id}`}
                  />
                )}

              </li>
            );
          })}
        </ul>
      )}

      <p className="store-legal">
        Al comprar aceptas que las monedas no son reembolsables una vez enviadas
        como regalo. La compra en sí sí se puede reembolsar si el pago falla.
      </p>
    </div>
  );
}
