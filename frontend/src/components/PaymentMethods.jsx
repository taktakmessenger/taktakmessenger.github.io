import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { getStripe, saveCardWithStripe } from '../services/stripe';

// Métodos de pago guardados.
//
// Aquí el usuario registra su tarjeta y su cuenta de PayPal una sola vez, y
// luego puede pagar sin volver a escribir nada.
//
// Lo que esta pantalla NO hace, a propósito: pedir el número de tarjeta a
// nuestro servidor. El formulario de tarjeta lo pinta Stripe con su clave
// publicable y el número va de aquí DIRECTO a Stripe. Nuestro backend solo
// recibe un identificador. Guardar el número nos metería en PCI-DSS y un vuelco
// de la base entregaría tarjetas usables.

const BRAND_LABEL = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

function brandLabel(brand) {
  if (!brand) return 'Tarjeta';
  return BRAND_LABEL[brand] || brand.charAt(0).toUpperCase() + brand.slice(1);
}

export default function PaymentMethods({ onBack, paypalOrderId, onPaypalConfirmed }) {
  const [methods, setMethods] = useState([]);
  const [providers, setProviders] = useState({ stripe: false, paypal: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  // Formulario de tarjeta.
  const [showCard, setShowCard] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [label, setLabel] = useState('');
  const elementsRef = useRef(null);
  const clientSecretRef = useRef(null);
  const publishableKeyRef = useRef(null);
  const cardMountRef = useRef(null);
  const cardElementRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/payments/methods');
      setMethods(data.methods);
      setProviders(data.providers);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Vuelta de PayPal: la URL trae el id de la orden aprobada. Se confirma aquí
  // para guardar el método. Se limpia la URL después para que recargar la página
  // no reintente una confirmación ya hecha (PayPal no permite capturar dos veces
  // la misma orden).
  useEffect(() => {
    if (!paypalOrderId) return undefined;
    let cancelled = false;

    (async () => {
      setBusy('paypal-confirm');
      try {
        const { data } = await api.post('/payments/methods/paypal/confirm', {
          orderId: paypalOrderId,
        });
        if (cancelled) return;
        setNotice(`PayPal vinculado: ${data.method.display}`);
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setBusy('');
          onPaypalConfirmed?.();
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paypalOrderId, load, onPaypalConfirmed]);

  // Al abrir el formulario se pide un SetupIntent y se monta el campo de tarjeta
  // de Stripe. Se hace aquí y no al cargar la pantalla para no traer Stripe.js a
  // quien solo viene a mirar.
  useEffect(() => {
    if (!showCard) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.post('/payments/methods/card/setup');
        if (cancelled) return;

        const stripe = await getStripe(data.publishableKey);
        if (cancelled) return;

        const elements = stripe.elements({
          clientSecret: data.clientSecret,
          appearance: { theme: 'night', variables: { colorPrimary: '#e0218a' } },
        });
        const card = elements.create('payment');
        card.mount(cardMountRef.current);

        clientSecretRef.current = data.clientSecret;
        publishableKeyRef.current = data.publishableKey;
        elementsRef.current = elements;
        cardElementRef.current = card;
        setCardReady(true);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
      // Desmontar el elemento libera el iframe de Stripe; sin esto quedaría un
      // formulario vivo cada vez que se abre y se cierra.
      try {
        cardElementRef.current?.unmount();
      } catch {
        /* ya estaba desmontado */
      }
      cardElementRef.current = null;
      elementsRef.current = null;
      setCardReady(false);
    };
  }, [showCard]);

  async function submitCard(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy('card');
    try {
      // El número se confirma contra Stripe; aquí solo vuelve el identificador.
      const paymentMethodId = await saveCardWithStripe({
        stripe: await getStripe(publishableKeyRef.current),
        clientSecret: clientSecretRef.current,
        elements: elementsRef.current,
      });

      await api.post('/payments/methods/card', { paymentMethodId, label });
      setShowCard(false);
      setLabel('');
      setNotice('Tarjeta guardada. Ya puedes pagar sin volver a escribirla.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function linkPaypal() {
    setError('');
    setNotice('');
    setBusy('paypal');
    try {
      const { data } = await api.post('/payments/methods/paypal/link');
      // La aprobación ocurre en PayPal. Al volver, la app trae `orderId` y lo
      // confirma en el backend.
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  async function makeDefault(id) {
    setError('');
    setBusy(id);
    try {
      await api.post(`/payments/methods/${id}/default`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function remove(id) {
    setError('');
    setBusy(id);
    try {
      await api.delete(`/payments/methods/${id}`);
      setNotice('Método eliminado');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const anyProvider = providers.stripe || providers.paypal;

  return (
    <div className="payment-methods">
      <div className="screen-head">
        {onBack && (
          <button type="button" className="btn-ghost" onClick={onBack} aria-label="Volver">
            ←
          </button>
        )}
        <h2>💳 Métodos de pago</h2>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <p className="store-hint">
        Guarda tu tarjeta o tu cuenta de PayPal una vez y paga sin volver a
        escribirla. El número de tu tarjeta nunca se guarda en TAK TAK: lo
        custodia la pasarela de pago.
      </p>

      {!anyProvider && !loading && (
        <div className="store-closed" role="status">
          <strong>El cobro todavía no está configurado</strong>
          <small>Vuelve más tarde: los pagos estarán disponibles en breve.</small>
        </div>
      )}

      {loading ? (
        <p className="centered">Cargando métodos…</p>
      ) : methods.length === 0 ? (
        <p className="centered">Aún no tienes métodos guardados.</p>
      ) : (
        <ul className="method-list">
          {methods.map((m) => (
            <li key={m.id} className={`method-card ${m.isDefault ? 'is-default' : ''}`}>
              <span className="method-icon" aria-hidden="true">
                {m.kind === 'paypal' ? '🅿️' : '💳'}
              </span>
              <div className="method-info">
                <span className="method-name">{m.display}</span>
                {m.kind === 'card' && m.expMonth && (
                  <small className="method-meta">
                    Caduca {String(m.expMonth).padStart(2, '0')}/{String(m.expYear).slice(-2)}
                  </small>
                )}
                {m.isDefault && <span className="method-badge">Predeterminado</span>}
              </div>
              <div className="method-actions">
                {!m.isDefault && (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={busy === m.id}
                    onClick={() => makeDefault(m.id)}
                  >
                    Predeterminar
                  </button>
                )}
                <button
                  type="button"
                  className="btn-link danger"
                  disabled={busy === m.id}
                  onClick={() => remove(m.id)}
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="method-add">
        {providers.stripe && !showCard && (
          <button type="button" className="btn-primary" onClick={() => setShowCard(true)}>
            💳 Añadir tarjeta
          </button>
        )}
        {providers.paypal && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy === 'paypal'}
            onClick={linkPaypal}
          >
            🅿️ {busy === 'paypal' ? 'Abriendo PayPal…' : 'Vincular PayPal'}
          </button>
        )}
      </div>

      {showCard && (
        <form className="card-form" onSubmit={submitCard}>
          <h3>Datos de la tarjeta</h3>
          {/* Aquí Stripe monta su propio formulario. El número no pasa por
              nuestro código ni por nuestro servidor. */}
          <div ref={cardMountRef} className="card-element" />
          <input
            type="text"
            placeholder="Nombre para reconocerla (opcional)"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="modal-buttons">
            <button type="submit" className="btn-primary" disabled={!cardReady || busy === 'card'}>
              {busy === 'card' ? 'Guardando…' : 'Guardar tarjeta'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowCard(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <p className="store-legal">
        Guardar un método no cobra nada. El cobro ocurre solo cuando compras
        monedas, y las monedas aparecen cuando la pasarela confirma el pago.
      </p>
    </div>
  );
}
