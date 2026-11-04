// Helpers de la mesa de POKERTAK. Están aparte del componente para poder
// probarlos sin navegador: colocación de los asientos, formato de monedas y qué
// acciones puede hacer un jugador según el estado que manda el servidor.

// Radios del anillo de asientos, medidos para el móvil (412x892, óvalo de 66vh)
// con el recuadro más grande que cabe: se eligieron buscando, para cada número
// de jugadores, la colocación con más separación horizontal que deja cero
// solapes y ningún asiento fuera del tapete.
const SEAT_RING = {
  1: { rx: 0, ry: 34, cy: 50 },
  2: { rx: 53, ry: 34.5, cy: 50 },
  3: { rx: 46.5, ry: 39, cy: 46 },
  4: { rx: 40.5, ry: 35, cy: 50 },
  5: { rx: 43, ry: 39.5, cy: 46 },
  6: { rx: 47, ry: 36, cy: 50 },
  7: { rx: 42, ry: 38.5, cy: 48 },
  8: { rx: 41.5, ry: 37, cy: 50 },
  9: { rx: 42.5, ry: 37.5, cy: 48 },
};
// Coloca los asientos alrededor de la mesa ovalada, hasta nueve (la mesa en
// vivo). Devuelve posiciones en porcentaje del contenedor, con el asiento 0
// abajo (el más cercano a quien mira) y el resto en el sentido del reloj.
export function seatLayout(count) {
  const seats = Math.max(1, Math.min(9, Number(count) || 1));
  const { rx, ry, cy } = SEAT_RING[seats];
  const positions = [];
  for (let i = 0; i < seats; i += 1) {
    // Se empieza abajo (90°) y se avanza en el sentido del reloj.
    const angle = (90 + (360 / seats) * i) * (Math.PI / 180);
    positions.push({
      x: 50 + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }
  return positions;
}

// Tamaño de cada recuadro de asiento según cuántos se sientan. Cuantos menos,
// más grande se ve la cara y las cartas; con nueve se encoge para que todos
// quepan sin solaparse.
export function seatScale(count) {
  const seats = Math.max(1, Math.min(9, Number(count) || 1));
  // Los topes no son capricho: con escala 1.2 el recuadro crecía tanto que el
  // asiento de abajo se salía del tapete. Con 1.05 (pocos jugadores) la cara y
  // las cartas se ven bien grandes y todo sigue dentro de la mesa.
  if (seats <= 2) return 1.1;
  if (seats <= 4) return 1.05;
  if (seats <= 6) return 1;
  if (seats <= 7) return 0.95;
  if (seats <= 8) return 0.9;
  return 0.86;
}

// Ajusta el tamaño de los asientos y decide qué plazas libres se enseñan.
//
// Los jugadores se reparten por todo el óvalo según cuántos son (así, con pocos
// sentados, cada uno tiene su sitio y la cara y las cartas se ven grandes). El
// recuadro de un jugador crece hasta el mayor tamaño que cabe sin pisar a otro ni
// salirse del tapete.
//
// Las plazas libres se quedan en las sillas del aforo completo y en pequeño, y
// solo se enseñan las que caben sin pisar a nadie: si un hueco cae encima de un
// jugador, no se pinta. Es preferible perder una marca de "libre" a tapar a
// quien está jugando.
//
// Se mide de verdad (ancho y alto reales del recuadro y del tapete) en lugar de
// fiarse de números fijos, así el ajuste vale igual en un móvil que en pantalla
// grande. Devuelve `{ scale, emptySeats }`.
export function fitSeats(occupiedSeats, base, felt, emptyScale = 0.62) {
  const taken = (Array.isArray(occupiedSeats) ? occupiedSeats : []).map(Number);
  const { w: baseW, h: baseH } = base || {};
  const { w: feltW, h: feltH } = felt || {};
  if (!(baseW > 0) || !(baseH > 0) || !(feltW > 0) || !(feltH > 0)) {
    return { scale: 1, emptySeats: [] };
  }
  const box = (p, scale) => {
    const w = baseW * scale;
    const h = baseH * scale;
    const cx = (p.x / 100) * feltW;
    const cy = (p.y / 100) * feltH;
    return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
  };
  const overlaps = (a, b) => !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);
  // 2 px de margen: el borde del tapete también ocupa.
  const inside = (b) => b.l >= 2 && b.r <= feltW - 2 && b.t >= 2 && b.b <= feltH - 2;

  const ring = seatLayout(taken.length || 1);
  const occupiedFits = (scale) => {
    const bs = ring.map((p) => box(p, scale));
    for (let i = 0; i < bs.length; i += 1) {
      if (!inside(bs[i])) return false;
      for (let j = i + 1; j < bs.length; j += 1) if (overlaps(bs[i], bs[j])) return false;
    }
    return true;
  };
  let lo = 0.45;
  let hi = 1.2;
  if (!occupiedFits(lo)) {
    // Ni con el mínimo caben: se usa el mínimo y se recortan las plazas libres.
    lo = 0.45;
  } else {
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2;
      if (occupiedFits(mid)) lo = mid; else hi = mid;
    }
  }
  // Hacia abajo: redondear al alza volvería a meter el asiento justo en el
  // límite y podría pisar al de al lado por unas décimas.
  const scale = Math.floor(lo * 100) / 100;

  const occupiedBoxes = ring.map((p) => box(p, scale));
  const emptySeats = [];
  seatLayout(9).forEach((p, seat) => {
    if (taken.includes(seat)) return;
    const b = box(p, emptyScale);
    if (!inside(b)) return;
    if (occupiedBoxes.some((o) => overlaps(o, b))) return;
    if (emptySeats.some((s2) => overlaps(box(seatLayout(9)[s2], emptyScale), b))) return;
    emptySeats.push(seat);
  });
  return { scale, emptySeats };
}

// Monedas con separador de miles y sin decimales innecesarios: "1.250" o "19,8".
// Se formatea a mano (y no con `toLocaleString`) para que el resultado sea el
// mismo en el navegador y en las pruebas, que corren en un Node sin datos de
// locale completos.
export function formatCoins(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  const [whole, decimals] = Math.abs(rounded).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = rounded < 0 ? '-' : '';
  const cents = decimals === '00' ? '' : `,${decimals.replace(/0$/, '')}`;
  return `${sign}${grouped}${cents}`;
}

// Etiqueta corta de una acción para el historial ("sube a 60", "pasa"…).
export function actionLabel(action, amount) {
  switch (action) {
    case 'fold': return 'Se retira';
    case 'check': return 'Pasa';
    case 'call': return 'Iguala';
    case 'bet': return `Apuesta ${formatCoins(amount)}`;
    case 'raise': return `Sube a ${formatCoins(amount)}`;
    case 'all-in': return 'All-in';
    default: return '';
  }
}

/**
 * Qué puede hacer el jugador al que le toca. Recibe el estado público de la mesa
 * y la posición del jugador; devuelve también los importes para el deslizador de
 * subida. Si no es su turno, todo va a falso.
 */
export function legalActions(state, seat) {
  const self = state?.seats?.[seat];
  const none = {
    yourTurn: false, canFold: false, canCheck: false, canCall: false,
    canRaise: false, canAllIn: false, toCall: 0, minRaiseTo: 0, maxRaiseTo: 0,
  };
  if (!state || !self || self.empty || self.folded || self.allIn) return none;
  if (state.turnSeat !== seat) return none;
  if (state.phase === 'waiting' || state.phase === 'showdown') return none;

  const toCall = Math.max(0, (state.currentBet || 0) - (self.bet || 0));
  const maxRaiseTo = (self.bet || 0) + (self.stack || 0);
  const minRaiseTo = state.currentBet > 0
    ? (state.currentBet || 0) + (state.minRaise || state.bigBlind || 0)
    : (state.bigBlind || 0);

  return {
    yourTurn: true,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    // Solo se puede subir si quedan fichas por encima de igualar.
    canRaise: maxRaiseTo > toCall && maxRaiseTo >= minRaiseTo,
    canAllIn: (self.stack || 0) > 0,
    toCall,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
  };
}

// El asiento del jugador propio dentro del estado, o -1 si no está sentado.
export function ownSeat(state, userId) {
  if (!state || userId == null) return -1;
  return (state.seats || []).findIndex((s) => !s.empty && String(s.userId) === String(userId));
}

// Fase en castellano, para el rótulo de la mesa.
export function phaseLabel(phase) {
  return {
    waiting: 'Esperando jugadores',
    preflop: 'Pre-flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
  }[phase] || '';
}
