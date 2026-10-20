import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [monetization, setMonetization] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showGift, setShowGift] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [gift, setGift] = useState({ recipient: '', amount: '', giftName: '' });
  const [withdraw, setWithdraw] = useState({ amount: '', method: 'paypal', details: '' });

  const loadWallet = useCallback(async () => {
    try {
      const [walletRes, txRes, monetizationRes] = await Promise.all([
        api.get('/wallet'),
        api.get('/wallet/transactions'),
        api.get('/wallet/monetization'),
      ]);
      setWallet(walletRes.data);
      setTransactions(txRes.data);
      setMonetization(monetizationRes.data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  async function handleGift(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      // The API takes a recipient id, so resolve the @username first.
      const { data: profile } = await api.get(`/users/${gift.recipient.replace('@', '')}`);
      await api.post('/wallet/gift', {
        recipientId: profile.user._id,
        amount: Number(gift.amount),
        giftName: gift.giftName || undefined,
      });
      setShowGift(false);
      setGift({ recipient: '', amount: '', giftName: '' });
      setNotice('Regalo enviado exitosamente');
      await loadWallet();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleWithdraw(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api.post('/wallet/withdraw', {
        amount: Number(withdraw.amount),
        method: withdraw.method,
        details: withdraw.details,
      });
      setShowWithdraw(false);
      setWithdraw({ amount: '', method: 'paypal', details: '' });
      setNotice('Solicitud de retiro enviada');
      await loadWallet();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!wallet) return <div className="centered">Cargando wallet…</div>;

  return (
    <div className="wallet">
      <h2>💰 Tu Wallet TAK TAK</h2>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="wallet-stats">
        <div className="stat-card ttc-c">
          <h3>Monedas</h3>
          <span className="amount">{wallet.coins.toFixed(2)}</span>
          <small>Para enviar regalos</small>
        </div>
        <div className="stat-card ttc-r">
          <h3>Diamantes</h3>
          <span className="amount">{wallet.diamonds.toFixed(2)}</span>
          <small>Retirables</small>
        </div>
        <div className="stat-card total">
          <h3>Total TTC</h3>
          <span className="amount">{wallet.totalTTC.toFixed(2)}</span>
        </div>
      </div>

      {monetization && (
        <div className="monetization-banner">
          <strong>✅ {monetization.message}</strong>
          <small>
            Ganas el {Math.round(monetization.creatorShare * 100)}% de cada regalo.
            La plataforma retiene el {Math.round(monetization.platformShare * 100)}%.
          </small>
        </div>
      )}

      <div className="wallet-actions">
        <button type="button" className="btn-primary" onClick={() => setShowGift(true)}>
          🎁 Enviar regalo
        </button>
        <button type="button" className="btn-secondary" onClick={() => setShowWithdraw(true)}>
          💸 Retirar Diamantes
        </button>
      </div>

      {showGift && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <h3>Enviar regalo</h3>
            <form onSubmit={handleGift}>
              <input
                type="text"
                placeholder="@usuario"
                value={gift.recipient}
                onChange={(e) => setGift({ ...gift, recipient: e.target.value })}
                required
              />
              <input
                type="number"
                placeholder="Monto en Monedas"
                value={gift.amount}
                onChange={(e) => setGift({ ...gift, amount: e.target.value })}
                min="0.01"
                step="0.01"
                required
              />
              <input
                type="text"
                placeholder="Regalo (ej. Rosa, León)"
                value={gift.giftName}
                onChange={(e) => setGift({ ...gift, giftName: e.target.value })}
                maxLength={40}
              />
              <small>El creador recibe el 75% del valor en Diamantes.</small>
              <div className="modal-buttons">
                <button type="submit" className="btn-primary">Enviar</button>
                <button type="button" className="btn-secondary" onClick={() => setShowGift(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showWithdraw && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <h3>Retirar Diamantes</h3>
            <form onSubmit={handleWithdraw}>
              <input
                type="number"
                placeholder="Monto en Diamantes"
                value={withdraw.amount}
                onChange={(e) => setWithdraw({ ...withdraw, amount: e.target.value })}
                min="0.01"
                step="0.01"
                required
              />
              <select
                value={withdraw.method}
                onChange={(e) => setWithdraw({ ...withdraw, method: e.target.value })}
              >
                <option value="paypal">PayPal</option>
                <option value="zelle">Zelle</option>
                <option value="crypto">Cripto</option>
              </select>
              <input
                type="text"
                placeholder="Detalles de pago"
                value={withdraw.details}
                onChange={(e) => setWithdraw({ ...withdraw, details: e.target.value })}
              />
              <div className="modal-buttons">
                <button type="submit" className="btn-primary">Solicitar</button>
                <button type="button" className="btn-secondary" onClick={() => setShowWithdraw(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="transactions">
        <h3>Historial de transacciones</h3>
        {transactions.length === 0 ? (
          <p>No hay transacciones aún.</p>
        ) : (
          <ul>
            {transactions.map((tx) => (
              <li key={tx._id} className={`transaction ${tx.type}`}>
                <span>
                  {tx.type === 'gift' ? '🎁' : tx.type === 'withdraw' ? '💸' : '⛏️'}{' '}
                  {tx.amount} TTC
                </span>
                <small>{new Date(tx.createdAt).toLocaleString()}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
