/**
 * TakCoin (TKC): la única moneda del ecosistema.
 *
 * Los valores salen del contrato desplegado en Polygon Amoy
 * (contracts/deployments/80002.json), no de una copia inventada:
 *
 *   name      "TakCoin"
 *   symbol    "TKC"
 *   decimals  18
 *   MAX_SUPPLY 100_000_000 ether
 *
 * El contrato tiene un único `balanceOf` por dirección, así que la app también
 * usa un único saldo. Los antiguos "TTC-C" y "TTC-R" se retiraron junto con toda
 * la economía de prueba: no existían on-chain y se valoraban a precios distintos
 * (1000x de diferencia entre pantalla y backend). Aquí queda un solo saldo, un
 * solo tipo de cambio, y todos los usuarios arrancan en cero.
 */

export const TKC = {
  name: 'TakCoin',
  symbol: 'TKC',
  decimals: 18,
  maxSupply: 100_000_000,
} as const;

/**
 * Tipo de cambio interno de referencia, en USD por 1 TKC.
 *
 * Es la única constante de precio de la app. Antes el frontend usaba 0.00001 y
 * el backend 0.01 para la misma moneda, lo que hacía que la pantalla mostrara
 * $10 mientras el backend habilitaba un retiro de $10.000. Cualquier pantalla
 * que convierta a dólares debe leer este valor, nunca escribir su propio número.
 */
export const TKC_USD_RATE = 0.01;

/** Convierte TKC a USD usando el tipo de cambio único. */
export function tkcToUsd(amount: number): number {
  return amount * TKC_USD_RATE;
}

/** Convierte USD a TKC usando el tipo de cambio único. */
export function usdToTkc(usd: number): number {
  return usd / TKC_USD_RATE;
}

/** Formatea un saldo TKC con separadores de miles. */
export function formatTkc(amount: number): string {
  return (amount ?? 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formatea un importe en dólares derivado de TKC. */
export function formatTkcUsd(amount: number): string {
  return `$${tkcToUsd(amount ?? 0).toFixed(2)}`;
}
