import test from 'node:test';
import assert from 'node:assert/strict';
import { walletUri } from '../src/lib/walletPay.js';

// `walletUri` es lo que se codifica en el QR. Se prueba aquí porque un fallo
// aquí no se ve en pantalla: el QR se pinta igual, pero la wallet abre la red
// equivocada y el pago se pierde.

test('sin red conocida se codifica solo la dirección', () => {
  // Un esquema inventado sería peor que ninguno: la wallet no lo entendería.
  assert.equal(walletUri({ address: 'TXYZ123', network: 'RARA' }), 'TXYZ123');
  assert.equal(walletUri({ address: 'TXYZ123', network: '' }), 'TXYZ123');
});

test('TRC20 usa el esquema tron', () => {
  assert.equal(
    walletUri({ address: 'TXYZ123', network: 'TRC20' }),
    'tron:TXYZ123'
  );
});

test('ERC20 usa el esquema ethereum', () => {
  assert.equal(
    walletUri({ address: '0xabc', network: 'ERC20' }),
    'ethereum:0xabc'
  );
});

test('el importe va en unidades mínimas (USDT usa 6 decimales)', () => {
  // 6.99 USDT = 6990000 unidades. Se calcula con enteros para no arrastrar el
  // error de coma flotante de 6.99 * 10^6.
  assert.equal(
    walletUri({ address: 'TXYZ', network: 'TRC20', amount: 6.99 }),
    'tron:TXYZ?value=6990000'
  );
});

test('BEP20 usa 18 decimales, no 6', () => {
  // USDT en BNB Smart Chain tiene 18 decimales. Con 6, el QR codificaría un
  // importe un billón de veces menor y la wallet enviaría una miseria.
  assert.equal(
    walletUri({ address: '0xabc', network: 'BEP20', amount: 6.99 }),
    'ethereum:0xabc?value=6990000000000000000'
  );
  assert.equal(
    walletUri({ address: '0xabc', network: 'BSC', amount: 1 }),
    'ethereum:0xabc?value=1000000000000000000'
  );
});

test('unos decimales explícitos mandan sobre los de la red', () => {
  assert.equal(
    walletUri({ address: '0xabc', network: 'BEP20', amount: 2, decimals: 6 }),
    'ethereum:0xabc?value=2000000'
  );
});

test('sin importe no se añade el parámetro value', () => {
  assert.equal(walletUri({ address: 'TXYZ', network: 'TRC20' }), 'tron:TXYZ');
});

test('sin dirección no hay URI', () => {
  assert.equal(walletUri({ address: '', network: 'TRC20' }), '');
});
