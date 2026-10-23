import { useEffect, useState } from 'react';
import api from '../api/client';

// Pantalla de vuelta tras pagar.
//
// Aviso importante: esta pantalla NO acredita nada. Solo enseña el saldo actual
// y espera a que el webhook del proveedor lo haya subido. Si acreditara aquí,
// cualquiera que abriera la URL se regalaría monedas, porque la URL de retorno
// es pública. Por eso el botón "Comprobar" simplemente vuelve a leer el saldo.
export default function PaymentResult({ provider, onDone }) {
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);

  async function check() {
    try {
      const { data } = await api.get('/wallet');
      setWallet(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    check();
  }, []);

  // El webhook puede tardar unos segundos en llegar. Se reintenta solo unas
  // pocas veces: insistir más sería marear al usuario con un saldo que no
  // cambia, y el dinero no se pierde aunque cierre la pantalla.
  useEffect(() => {
    if (attempts >= 5) return undefined;
    const timer = setTimeout(() => {
      setAttempts((n) => n + 1);
      check();
    }, 2000);
    return () => clearTimeout(timer);
  }, [attempts]);

  return (
    <div className="payment-result">
      <div className="screen-head">
        <h2>✅ Pago completado</h2>
      </div>

      <p className="payment-provider">
        {provider === 'paypal' ? 'PayPal' : 'Tarjeta'} ha confirmado tu compra.
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      {wallet && (
        <div className="wallet-stats">
          <div className="stat-card ttc-c">
            <h3>Monedas</h3>
            <span className="amount">{wallet.coins.toFixed(2)}</span>
          </div>
        </div>
      )}

      <p className="payment-note">
        Las monedas pueden tardar unos segundos en aparecer. Si no las ves,
        vuelve a entrar: el pago ya está registrado y no se pierde.
      </p>

      <div className="wallet-actions">
        <button type="button" className="btn-primary" onClick={check}>
          🔄 Comprobar saldo
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Volver al monedero
        </button>
      </div>
    </div>
  );
}
