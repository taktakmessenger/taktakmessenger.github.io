import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobile, metamaskDeepLink } from '../src/lib/takcoin.js';

// Estas dos funciones deciden si el aviso de "conecta tu cartera" se convierte
// en un botón que abre MetaMask. Se les inyecta el user-agent y el host, así que
// se prueba la lógica real sin navegador ni wallet.

test('detecta móviles por el user-agent', () => {
  assert.equal(isMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
  assert.equal(isMobile('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), true);
  assert.equal(isMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
  assert.equal(isMobile(''), false);
});

test('el enlace directo abre la tienda dentro de MetaMask', () => {
  assert.equal(
    metamaskDeepLink('taktak.vip'),
    'https://metamask.app.link/dapp/taktak.vip/?view=tienda'
  );
});

test('sin host cae al enlace genérico de MetaMask', () => {
  assert.equal(metamaskDeepLink(''), 'https://metamask.app.link');
});
