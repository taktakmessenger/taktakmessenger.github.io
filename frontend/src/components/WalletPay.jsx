import { useEffect, useState } from 'react';
import { copyToClipboard } from '../lib/share';
import { walletQrDataUrl, walletUri } from '../lib/walletPay';

// Pago con billetera cripto (USDT).
//
// Se ofrece PRIMERO, antes que cualquier otra vía, porque es la que cobra sin
// intermediarios: no hay pasarela que retenga el dinero ni comisión que se lo
// coma. El usuario escanea el QR o copia la dirección, envía el importe exacto
// desde su wallet y pega el hash de la transacción para que se compruebe.
//
// Lo que la pantalla tiene que dejar claro, por encima de todo, es la RED. Un
// USDT enviado por la red equivocada se pierde y no hay vuelta atrás, así que la
// red va en grande y en su propio recuadro, no como letra pequeña.

export default function WalletPay({ method, priceUsd, reference, onReference, onSubmit, busy }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');

  const uri = walletUri({ address: method.payTo, network: method.network, amount: priceUsd });

  useEffect(() => {
    let alive = true;
    walletQrDataUrl(uri).then((url) => {
      if (alive) setQr(url);
    });
    return () => {
      alive = false;
    };
  }, [uri]);

  async function copy(key, value) {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? '' : current)), 2000);
  }

  return (
    <div className="wallet-pay">
      <div className="wallet-pay-amount">
        Envía exactamente <strong>{Number(priceUsd).toFixed(2)} {method.asset}</strong>
      </div>

      {method.network && (
        <div className="wallet-pay-network" role="note">
          ⚠️ Red obligatoria: <strong>{method.network}</strong>
          <small>Por otra red el dinero se pierde.</small>
        </div>
      )}

      {qr && (
        <div className="wallet-pay-qr">
          <img src={qr} alt={`Código QR para pagar con ${method.asset} en la red ${method.network}`} />
          <small>Escanea con tu wallet (MetaMask, Trust, Binance…)</small>
        </div>
      )}

      <div className="manual-pay-copy">
        <code className="manual-pay-value">{method.payTo}</code>
        <button
          type="button"
          className="btn-ghost manual-pay-copy-btn"
          onClick={() => copy('addr', method.payTo)}
        >
          {copied === 'addr' ? '✅ Copiado' : '📋 Copiar'}
        </button>
      </div>

      {method.details && <p className="manual-pay-instructions">{method.details}</p>}

      <input
        type="text"
        placeholder="Hash de la transacción (TXID)"
        value={reference}
        onChange={(e) => onReference(e.target.value)}
        aria-label="Hash de la transacción"
      />
      <button
        type="button"
        className="btn-primary"
        disabled={!reference || busy}
        onClick={onSubmit}
      >
        {busy ? 'Enviando…' : 'Ya pagué, enviar comprobante'}
      </button>
    </div>
  );
}
