import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { copyToClipboard } from '../lib/share';
import {
  hasWallet,
  connectWallet,
  ensureChain,
  getTokenBalance,
  claimReward,
  watchToken,
} from '../lib/takcoin';

// Panel de minado de TakCoin (TKC).
//
// El minado se cobra on-chain: la app pide un vale firmado al backend y el
// usuario lo cobra con su wallet. Las monedas minadas son promocionales (se
// gastan en regalos, no se retiran), así que este panel nunca promete dinero.
//
// Si el servidor no tiene configurado el contrato o la clave del oráculo, el
// panel lo dice y no ofrece botones que no funcionarían.

const CHAIN_LABEL = { 56: 'BNB Smart Chain', 137: 'Polygon', 80002: 'Polygon Amoy (pruebas)' };

export default function TakCoinMining({ onMined }) {
  const [config, setConfig] = useState(null);
  const [state, setState] = useState({ loading: true, error: '', notice: '' });
  const [wallet, setWallet] = useState({ address: '', balance: '' });
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await api.get('/mining/config');
      setConfig(data);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function connect() {
    setState({ loading: false, error: '', notice: '' });
    setBusy('connect');
    try {
      const provider = await connectWallet();
      if (config?.chainId) await ensureChain(config.chainId);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const balance = config?.contract ? await getTokenBalance(config.contract) : '';
      setWallet({ address, balance });
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setBusy('');
    }
  }

  async function claim() {
    setState((s) => ({ ...s, error: '', notice: '' }));
    setBusy('claim');
    try {
      const { data: voucher } = await api.post('/mining/voucher', { address: wallet.address });
      const { hash } = await claimReward(config.contract, voucher);
      // Se registra en el servidor solo después de que la transacción se
      // liquide: así el saldo de la app y el TKC de la wallet cuadran.
      await api.post('/mining/claimed', { coins: voucher.coins, videos: voucher.videos, txHash: hash });
      const balance = await getTokenBalance(config.contract);
      setWallet((w) => ({ ...w, balance }));
      setState((s) => ({
        ...s,
        notice: `¡Cobrados ${voucher.coins} TKC! Ya puedes usarlos en regalos.`,
      }));
      onMined?.();
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setBusy('');
    }
  }

  async function copyAddress() {
    const ok = await copyToClipboard(wallet.address);
    if (!ok) return;
    setCopied('addr');
    setTimeout(() => setCopied((c) => (c === 'addr' ? '' : c)), 2000);
  }

  async function addToken() {
    setBusy('watch');
    try {
      await watchToken(config.contract);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setBusy('');
    }
  }

  if (state.loading) return <p className="centered">Cargando minería…</p>;

  if (!config?.configured) {
    return (
      <div className="store-closed" role="status">
        <strong>Minería de TakCoin próximamente</strong>
        <small>
          El servidor todavía no tiene el contrato y la clave del oráculo. Cuando
          estén, aquí aparecerá el botón para cobrar lo minado.
        </small>
      </div>
    );
  }

  return (
    <div className="takcoin-mining">
      <p className="store-hint">
        Gana <strong>TKC</strong> viendo vídeos y cobra en tu cartera. Los TKC
        minados son <strong>monedas de regalo</strong>: sirven para enviar regalos,
        no se pueden retirar como dinero.
      </p>

      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.notice && <p className="notice" role="status">{state.notice}</p>}

      {!hasWallet() && (
        <p className="error" role="alert">
          Abre la app en MetaMask o instala su extensión para cobrar.
        </p>
      )}

      {wallet.address ? (
        <div className="takcoin-wallet">
          <p>Tu cartera</p>
          <div className="takcoin-address">
            <code className="takcoin-address-value">{wallet.address}</code>
            <button
              type="button"
              className="btn-ghost"
              onClick={copyAddress}
              aria-label="Copiar dirección de la cartera"
            >
              {copied === 'addr' ? '✅ Copiada' : '📋 Copiar'}
            </button>
          </div>
          <p>Saldo TKC: <strong>{wallet.balance || '0'}</strong></p>
          <div className="package-actions">
            <button type="button" className="btn-primary" onClick={claim} disabled={busy === 'claim'}>
              {busy === 'claim' ? 'Cobrando…' : '⛏️ Cobrar minado'}
            </button>
            <button type="button" className="btn-ghost" onClick={addToken} disabled={busy === 'watch'}>
              Añadir TKC a la cartera
            </button>
          </div>
          <small className="package-rate">
            Red: {CHAIN_LABEL[config.chainId] || `chainId ${config.chainId}`} ·{' '}
            {config.rewardPerVideo} TKC por vídeo (máx. {config.dailyVideoCap}/día)
          </small>
        </div>
      ) : (
        <button type="button" className="btn-primary" onClick={connect} disabled={busy === 'connect' || !hasWallet()}>
          {busy === 'connect' ? 'Conectando…' : '🔌 Conectar cartera'}
        </button>
      )}
    </div>
  );
}
