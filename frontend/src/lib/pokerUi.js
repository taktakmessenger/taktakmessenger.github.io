// Helpers de la mesa de POKERTAK. Están aparte del componente para poder
// probarlos sin navegador: colocación de los asientos, formato de monedas y qué
// acciones puede hacer un jugador según el estado que manda el servidor.

// Coloca hasta seis asientos alrededor de la mesa ovalada. Devuelve posiciones
// en porcentaje del contenedor, con el asiento 0 abajo (el más cercano a quien
// mira), y reparte el resto en el sentido del reloj. La elipse es más ancha que
// alta para que la mesa parezca una mesa de póker y no un círculo.
//
// Los radios (38% / 30%) van por dentro del borde del tapete: si se usara el
// borde entero (46% / 34%), el asiento de abajo quedaría medio fuera de la mesa.
export function seatLayout(count) {
  const seats = Math.max(1, Math.min(6, Number(count) || 1));
  const positions = [];
  for (let i = 0; i < seats; i += 1) {
    // Se empieza abajo (90°) y se avanza en el sentido del reloj.
    const angle = (90 + (360 / seats) * i) * (Math.PI / 180);
    positions.push({
      x: 50 + 38 * Math.cos(angle),
      y: 50 + 30 * Math.sin(angle),
    });
  }
  return positions;
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
