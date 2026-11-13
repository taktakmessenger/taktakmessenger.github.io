import { useEffect, useState } from 'react';
import api from '../api/client';
import { useSocket } from '../contexts/SocketContext';

// Botones de regalo del directo, al estilo de TikTok. El catálogo y el precio
// vienen del servidor (nunca del cliente); aquí solo se eligen. El cobro va por
// el endpoint del monedero y la animación por el socket, que es lo que ven los
// demás espectadores.
export default function LiveGifts({ room, recipientId, onSent }) {
  const { emit } = useSocket();
  const [gifts, setGifts] = useState([]);
  const [coins, setCoins] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api
      .get('/gifts')
      .then(({ data }) => setGifts(data.gifts))
      .catch((err) => setError(err.message));
    api
      .get('/wallet')
      .then(({ data }) => setCoins(data.spendable ?? data.coins))
      .catch(() => setCoins(null));
  }, []);

  async function send() {
    if (!selected || !recipientId) return;
    const gift = gifts.find((g) => g._id === selected);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/wallet/gift', { recipientId, giftId: selected });
      // La animación para los demás (y para uno mismo) va por el socket. El
      // dinero ya se movió en la llamada anterior: esto solo pinta.
      emit('live:gift', {
        room,
        giftName: gift?.name,
        iconUrl: gift?.iconUrl,
      });
      setNotice(`¡Enviaste ${gift?.name || 'un regalo'}!`);
      setSelected('');
      onSent?.(gift);
      // El saldo cambió: se relee para que los botones reflejen lo que queda.
      api
        .get('/wallet')
        .then(({ data }) => setCoins(data.spendable ?? data.coins))
        .catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const tooExpensive = (cost) => coins != null && cost > coins;

  return (
    <div className="live-gifts" aria-label="Regalos del directo">
      {coins != null && (
        <p className="live-gifts-balance">
          🪙 <strong>{coins}</strong>
        </p>
      )}

      {error && <p className="live-chat-error" role="alert">{error}</p>}
      {notice && <p className="live-gifts-notice" role="status">{notice}</p>}

      <div className="live-gifts-row">
        {gifts.map((g) => (
          <button
            key={g._id}
            type="button"
            className={`live-gift-btn ${selected === g._id ? 'selected' : ''}`}
            onClick={() => setSelected((prev) => (prev === g._id ? '' : g._id))}
            disabled={tooExpensive(g.coinCost)}
            title={tooExpensive(g.coinCost) ? 'No te llegan las monedas' : `${g.name} · ${g.coinCost} monedas`}
          >
            <span aria-hidden="true">🎁</span>
            <strong>{g.name}</strong>
            <small>{g.coinCost}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="btn-primary live-gifts-send"
        onClick={send}
        disabled={busy || !selected}
      >
        {busy ? 'Enviando…' : 'Enviar regalo'}
      </button>
    </div>
  );
}
