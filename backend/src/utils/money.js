// Aritmética de dinero exacta.
//
// La economía de TAK TAK guarda los saldos como `Number` en Mongo y los reparte
// con `round2`, que es suficiente para el día a día pero no para una frontera de
// entrada: un importe que llega del navegador como `0.1 + 0.2` no debe decidir
// si el usuario puede o no retirar. Este módulo convierte el importe a unidades
// enteras (BigInt) en el punto de entrada, de forma que la validación sea exacta
// y no dependa de la representación en coma flotante.
//
// No cambia cómo se almacenan los saldos: eso seguiría siendo un cambio de todo
// el libro contable. Solo garantiza que lo que se acepta del usuario es lo que
// se compara con el saldo.

const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);

/**
 * Convierte una cadena decimal (con punto) a unidades enteras.
 *
 * Acepta como máximo `inputDecimals` decimales introducidos (2 por defecto: la
 * economía de TAK TAK trabaja al céntimo). Devuelve `null` si el valor no es un
 * número positivo y finito dentro de los límites, para que el llamador decida el
 * mensaje. Nunca lanza: el error de formato no es un error de servidor.
 */
function parseMoney(text, inputDecimals = 2) {
  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    text.length > 80 ||
    !/^\d+(?:\.\d+)?$/.test(text)
  ) {
    return null;
  }

  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > inputDecimals) return null;

  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, '0') || '0');
  return units > 0n ? units : null;
}

/**
 * Formatea unidades enteras de vuelta a cadena decimal sin ceros sobrantes.
 */
function formatMoney(units) {
  if (typeof units !== 'bigint' || units < 0n) return null;
  const whole = units / SCALE;
  const fraction = (units % SCALE)
    .toString()
    .padStart(DECIMALS, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Convierte un `Number` de la base (saldo, importe guardado) a unidades enteras.
 * Redondea al céntimo porque el resto del sistema trabaja a 2 decimales.
 */
function numberToUnits(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return BigInt(Math.round(value * Number(SCALE)));
}

/** Cuántos decimales admite un importe de usuario en la frontera de entrada. */
const INPUT_DECIMALS = 2;

module.exports = { parseMoney, formatMoney, numberToUnits, DECIMALS, INPUT_DECIMALS };
