import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobile, metamaskDeepLink, walletDeepLink, WALLETS } from '../src/lib/takcoin.js';

// Estas funciones deciden qué botones de cartera ve el usuario y a dónde llevan.
// Se les inyecta el host, así que se prueba la lógica real sin navegador.

test('detecta móviles por el user-agent', () => {
  assert.equal(isMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
  assert.equal(isMobile('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), true);
  assert.equal(isMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
  assert.equal(isMobile(''), false);
});

test('el enlace directo de MetaMask abre la tienda dentro de la app', () => {
  assert.equal(
    metamaskDeepLink('taktak.vip'),
    'https://metamask.app.link/dapp/taktak.vip/?view=tienda'
  );
});

test('Trust Wallet abre la web con el coin_id de Polygon', () => {
  const url = walletDeepLink('trust', 'taktak.vip');
  assert.match(url, /link\.trustwallet\.com/);
  assert.match(url, /coin_id=966/);
  assert.match(url, /taktak\.vip/);
});

test('Coinbase Wallet lleva la url de la app', () => {
  const url = walletDeepLink('coinbase', 'taktak.vip');
  assert.match(url, /go\.cb-w\.com\/dapp/);
  assert.match(url, /taktak\.vip/);
});

test('una cartera desconocida no genera enlace', () => {
  assert.equal(walletDeepLink('nope', 'taktak.vip'), null);
});

test('todas las carteras listadas tienen nombre, icono y enlace', () => {
  for (const w of WALLETS) {
    assert.ok(w.name && w.emoji && w.installUrl, `cartera incompleta: ${JSON.stringify(w)}`);
  }
});

test('sin host se cae al enlace de instalación, no a una url rota', () => {
  assert.equal(walletDeepLink('metamask', ''), 'https://metamask.io/download/');
});

