// Reparto de premios de un torneo de POKERTAK.
//
// Un torneo no cobra comisión por mano como la mesa normal: cobra una única
// tarifa sobre todo lo recaudado y reparte el resto entre los primeros puestos.
// Es el modelo de las salas reales (PokerStars): la entrada se parte en "premio"
// y "tarifa", y solo el premio entra en el bote común.
//
// Este módulo es solo aritmética: recibe la entrada, cuántos jugadores hay, la
// tarifa de la casa y el reparto por puestos, y devuelve cuánto cobra cada uno y
// cuánto se queda la casa. No toca monederos ni base de datos, así que se puede
// probar con números y comprobar que nunca se reparte de más.

// Reparto por defecto: 40% al primero, 30% al segundo, 20% al tercero. El 10%
// que falta es la tarifa de la casa, así que el reparto y la tarifa cuadran
// (40+30+20 = 90, la casa se queda el 10 restante).
const DEFAULT_SPLIT = [0.4, 0.3, 0.2];
const DEFAULT_RAKE = 0.1;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula el reparto de un torneo.
 *
 * `split` es la parte de lo recaudado que va a cada puesto, de primero a último.
 * Si hay menos jugadores que puestos en el reparto, se pagan solo los puestos que
 * existen y sus porcentajes se reajustan para que en conjunto sumen siempre
 * `1 - rakeRate` de lo recaudado. Así la casa cobra su tarifa exacta aunque el
 * torneo se quede corto, y nunca se reparte dinero que no se recaudó.
 *
 * Devuelve el bruto, la tarifa, el bote de premios y la lista de puestos con el
 * importe ya redondeado. El último puesto absorbe el céntimo del redondeo para
 * que la suma de los premios cuadre con el bote al céntimo.
 */
function prizePayout({ buyIn, entrants, rakeRate = DEFAULT_RAKE, split = DEFAULT_SPLIT } = {}) {
  const players = Math.max(0, Math.floor(Number(entrants) || 0));
  const entry = Math.max(0, Number(buyIn) || 0);
  const rake = Math.min(Math.max(Number(rakeRate) || 0, 0), 1);
  const shares = (Array.isArray(split) && split.length ? split : DEFAULT_SPLIT)
    .map((s) => Math.max(0, Number(s) || 0));

  const gross = round2(entry * players);
  const houseCut = round2(gross * rake);
  const prizePool = round2(gross - houseCut);
  if (players === 0 || prizePool <= 0) {
    return { gross, rake: houseCut, prizePool, places: [] };
  }

  // Solo se pagan los puestos que existen, y solo los que tienen jugador.
  const paidPlaces = Math.min(shares.length, players);
  const usedShares = shares.slice(0, paidPlaces);
  const totalShare = usedShares.reduce((a, b) => a + b, 0);
  if (totalShare <= 0) {
    return { gross, rake: houseCut, prizePool, places: [] };
  }

  // Se reparte el bote entero en proporción a los porcentajes usados. Como el
  // reparto por defecto suma 90%, el resultado normal es 40/30/20 del bruto.
  //
  // Cada puesto se redondea HACIA ABAJO al céntimo y los céntimos que sobran se
  // reparten de uno en uno desde el primer puesto. Redondear al alza por puesto
  // haría que la suma se pasara del bote por unos céntimos; así nunca se reparte
  // más de lo recaudado y el sobrante acaba en el primer puesto.
  const places = usedShares.map((share, i) => ({
    place: i + 1,
    share: round2(share / totalShare),
    amount: Math.floor((prizePool * share) / totalShare * 100) / 100,
  }));

  let leftover = Math.round((prizePool - places.reduce((a, p) => a + p.amount, 0)) * 100);
  for (let i = 0; leftover > 0 && places.length; i = (i + 1) % places.length) {
    places[i].amount = round2(places[i].amount + 0.01);
    leftover -= 1;
  }

  return { gross, rake: houseCut, prizePool, places };
}

module.exports = { prizePayout, DEFAULT_SPLIT, DEFAULT_RAKE, round2 };
