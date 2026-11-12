import QRCode from 'qrcode';

// El código QR se genera en el propio navegador y no se pide a ninguna web.
//
// Es importante que sea así: el contenido del QR es la dirección de cobro, y
// mandarla a un servicio externo para que devuelva la imagen la expondría a un
// tercero. `toDataURL` la convierte en una imagen en memoria sin salir de aquí.

// Formatos de pago que entienden las wallets. `ethereum:` y `tron:` son los
// esquemas BIP-21 que MetaMask, Trust, Rainbow y compañía reconocen al escanear
// y rellenan la dirección y el importe solos. Se elige por la red declarada.
//
// Los decimales van con la red y no son un detalle: USDT tiene 6 en Ethereum y
// en Tron, pero 18 en BNB Smart Chain. Poner 6 en BEP20 codificaría un importe
// un billón de veces menor y la wallet enviaría una miseria.
const NETWORK_INFO = {
  ERC20: { scheme: 'ethereum', decimals: 6 },
  ETH: { scheme: 'ethereum', decimals: 6 },
  BEP20: { scheme: 'ethereum', decimals: 18 },
  BSC: { scheme: 'ethereum', decimals: 18 },
  TRC20: { scheme: 'tron', decimals: 6 },
  TRON: { scheme: 'tron', decimals: 6 },
};

/**
 * Texto que se codifica en el QR.
 *
 * Con red conocida se usa el esquema BIP-21 (`ethereum:0x…@56?value=…`) para que
 * la wallet abra ya rellenada. Sin red reconocida se codifica solo la dirección:
 * un esquema inventado sería peor que ninguno, porque la wallet no lo entendería.
 */
export function walletUri({ address, network, amount, decimals }) {
  if (!address) return '';
  const info = NETWORK_INFO[String(network || '').toUpperCase()];
  if (!info) return address;
  const base = `${info.scheme}:${address}`;
  if (!amount) return base;
  // El importe va en unidades mínimas según los decimales del token. Se calcula
  // con enteros para no arrastrar el error de coma flotante al multiplicar.
  const dp = Number.isInteger(decimals) ? decimals : info.decimals;
  const units = BigInt(Math.round(Number(amount) * 10 ** dp));
  return `${base}?value=${units.toString()}`;
}

/**
 * Devuelve un `data:` URL con el PNG del QR. Se genera en el navegador; si algo
 * falla (dirección vacía), devuelve cadena vacía y la UI simplemente no pinta
 * el QR, sin romper la pantalla.
 */
export async function walletQrDataUrl(uri, { size = 220 } = {}) {
  if (!uri) return '';
  try {
    return await QRCode.toDataURL(uri, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#07070d', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}
