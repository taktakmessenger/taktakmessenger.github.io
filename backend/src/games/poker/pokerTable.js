// Motor de una mesa de Texas Hold'em.
//
// Es la parte del juego que lleva la partida: quién está sentado, las ciegas, el
// reparto, las rondas de apuestas, el bote y quién lo gana en el showdown. No
// sabe nada de sockets ni de dinero real: trabaja con fichas (números). La capa
// de arriba es la que cobra y paga monedas.
//
// Está escrito sin dependencias para poder probar una partida entera de principio
// a fin sin navegador ni red.

const { createDeck, bestHand, compareScores, cardLabel } = require('./handEvaluator');

// Fases de una mano, en orden.
const PHASES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'];

// Cuántas cartas comunitarias se reparten en cada fase.
const BOARD_COUNT = { flop: 3, turn: 4, river: 5 };

let tableSeq = 0;

// Redondeo a céntimos: las monedas pueden llevar decimales.
function round2(n) {
  return Math.round(n * 100) / 100;
}

class PokerTable {
  constructor({ id, maxSeats = 6, smallBlind = 5, bigBlind = 10, minBuyIn = 10, maxBuyIn = 20000, rakeRate = 0, deckFactory = null } = {}) {
    this.id = id || `poker-${++tableSeq}`;
    this.maxSeats = maxSeats;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.minBuyIn = minBuyIn;
    this.maxBuyIn = maxBuyIn;
    // Fracción del bote que se queda la casa en cada mano terminada.
    this.rakeRate = rakeRate;
    // Solo para las pruebas: permite fijar el reparto y repetir una mano.
    this.deckFactory = deckFactory;
    this.seats = new Array(maxSeats).fill(null);
    this.buttonSeat = -1;
    this.phase = 'waiting';
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.turnSeat = null;
    this.deck = null;
    this.handNumber = 0;
    this.winners = [];
    this.lastAction = null;
    this.hostId = null;
  }

  /* ---------------------------------------------------------------- */
  /* Asientos                                                          */
  /* ---------------------------------------------------------------- */

  seatOf(userId) {
    return this.seats.findIndex((s) => s && String(s.userId) === String(userId));
  }

  players() {
    return this.seats.filter(Boolean);
  }

  // Jugadores que siguen en la mano (no se han retirado).
  livePlayers() {
    return this.players().filter((p) => !p.folded);
  }

  // Jugadores que aún pueden actuar: en la mano, con fichas y sin ir all-in.
  actors() {
    return this.players().filter((p) => !p.folded && !p.allIn && p.stack > 0);
  }

  seatedCount() {
    return this.players().length;
  }

  sitDown(userId, username, buyIn, { paidBuyIn = 0 } = {}) {
    if (this.seatOf(userId) !== -1) throw new Error('Ya estás sentado en esta mesa');
    const amount = Number(buyIn);
    if (!Number.isFinite(amount) || amount < this.minBuyIn) {
      throw new Error(`La entrada mínima es ${this.minBuyIn}`);
    }
    if (amount > this.maxBuyIn) throw new Error(`La entrada máxima es ${this.maxBuyIn}`);
    const seat = this.seats.findIndex((s) => s === null);
    if (seat === -1) throw new Error('La mesa está llena');
    this.seats[seat] = {
      seat,
      userId: String(userId),
      username,
      stack: amount,
      // Cuántas fichas de la pila están respaldadas por monedas pagadas (frente
      // a monedas de regalo). Lo fija quien cobra la entrada; el motor solo lo
      // arrastra para saber de qué tipo es cada moneda del bote.
      paidStack: Math.min(amount, Math.max(0, Number(paidBuyIn) || 0)),
      paidBet: 0,
      bet: 0,
      totalBet: 0,
      folded: true,
      allIn: false,
      acted: false,
      holeCards: [],
      handLabel: null,
      won: 0,
    };
    return this.seats[seat];
  }

  standUp(userId) {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new Error('No estás sentado en esta mesa');
    const player = this.seats[seat];
    // Si se levanta a mitad de mano, se retira primero para no dejar la mano
    // colgada esperando su turno.
    if (this.inHand(player) && !player.folded) this.foldSeat(seat);
    const stack = player.stack;
    this.seats[seat] = null;
    if (this.seatedCount() < 2) this.resetHand();
    return stack;
  }

  inHand(player) {
    return player.holeCards && player.holeCards.length > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Mano                                                              */
  /* ---------------------------------------------------------------- */

  resetHand() {
    this.phase = 'waiting';
    this.board = [];
    this.pot = 0;
    this.paidPot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.turnSeat = null;
    this.deck = null;
    this.winners = [];
    for (const p of this.players()) {
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
      p.holeCards = [];
      p.handLabel = null;
      p.won = 0;
    }
  }

  // Siguiente asiento ocupado en el sentido del reloj (o antes del reloj).
  nextOccupied(from, { skipFolded = false } = {}) {
    for (let step = 1; step <= this.maxSeats; step += 1) {
      const idx = (from + step) % this.maxSeats;
      const p = this.seats[idx];
      if (!p) continue;
      if (skipFolded && p.folded) continue;
      return idx;
    }
    return null;
  }

  /**
   * Reparte una mano nueva. Se necesitan al menos dos jugadores con fichas.
   * Coloca el botón, cobra las ciegas y da dos cartas a cada uno.
   */
  startHand() {
    const ready = this.players().filter((p) => p.stack > 0);
    if (ready.length < 2) throw new Error('Hacen falta al menos dos jugadores con fichas');
    // Fuera de la mano los que no tienen fichas.
    for (const p of this.players()) {
      if (p.stack <= 0) {
        p.folded = true;
        p.allIn = false;
        p.holeCards = [];
      }
    }
    this.resetHand();
    this.handNumber += 1;
    this.deck = this.deckFactory ? this.deckFactory() : createDeck();
    this.paidPot = 0;

    // El botón avanza al siguiente asiento con fichas; la primera mano va al
    // primero de la lista.
    this.buttonSeat = this.buttonSeat === -1
      ? this.seats.findIndex((s) => s && s.stack > 0)
      : this.nextOccupied(this.buttonSeat);

    const headsUp = this.players().filter((p) => p.stack > 0).length === 2;

    // Con dos jugadores el botón pone la ciega pequeña; con más, la pone el
    // siguiente al botón.
    const sbSeat = headsUp ? this.buttonSeat : this.nextOccupied(this.buttonSeat);
    const bbSeat = this.nextOccupied(sbSeat);

    this.postBlind(sbSeat, this.smallBlind);
    this.postBlind(bbSeat, this.bigBlind);

    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;

    // Dos cartas a cada jugador con fichas, empezando por el de la ciega pequeña.
    let seat = sbSeat;
    for (let round = 0; round < 2; round += 1) {
      seat = sbSeat;
      for (let i = 0; i < this.seatedCount(); i += 1) {
        const p = this.seats[seat];
        if (p && p.stack > 0) p.holeCards.push(this.deck.draw());
        seat = this.nextOccupied(seat);
      }
    }

    this.phase = 'preflop';
    // Preflop habla el siguiente a la ciega grande.
    this.turnSeat = this.nextActor(bbSeat);
    this.lastAction = 'Reparto inicial';
    return this.publicState();
  }

  postBlind(seat, amount) {
    const p = this.seats[seat];
    if (!p) return;
    this.commit(p, amount);
    p.acted = false;
  }

  // Siguiente asiento que puede actuar tras `from`, saltando retirados y
  // all-in. Devuelve null si no queda nadie por hablar.
  nextActor(from) {
    let idx = from;
    for (let step = 1; step <= this.maxSeats; step += 1) {
      idx = (idx + 1) % this.maxSeats;
      const p = this.seats[idx];
      if (!p) continue;
      if (p.folded || p.allIn || p.stack <= 0) continue;
      return idx;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Acciones                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Aplica la acción de un jugador. `amount` es el total al que sube (no el
   * incremento), como en las mesas reales: "subo a 60".
   */
  act(userId, action, amount) {
    const seat = this.seatOf(userId);
    if (seat === -1) throw new Error('No estás sentado en esta mesa');
    if (this.turnSeat !== seat) throw new Error('No es tu turno');
    const player = this.seats[seat];
    if (player.folded || player.allIn) throw new Error('No puedes actuar en esta mano');

    const toCall = Math.max(0, this.currentBet - player.bet);

    switch (action) {
      case 'fold': {
        this.foldSeat(seat);
        this.lastAction = `${player.username} se retira`;
        break;
      }
      case 'check': {
        if (toCall > 0) throw new Error(`Hay ${toCall} por igualar`);
        player.acted = true;
        this.lastAction = `${player.username} pasa`;
        break;
      }
      case 'call': {
        if (toCall <= 0) throw new Error('No hay nada que igualar');
        this.commit(player, Math.min(toCall, player.stack));
        player.acted = true;
        this.lastAction = player.allIn
          ? `${player.username} va all-in`
          : `${player.username} iguala ${this.currentBet}`;
        break;
      }
      case 'bet':
      case 'raise': {
        const target = Number(amount);
        if (!Number.isFinite(target)) throw new Error('Subida inválida');
        const isRaise = this.currentBet > 0;
        // La subida mínima es la última apuesta más el incremento anterior (o la
        // ciega grande). All-in por menos siempre se permite.
        const minTarget = isRaise ? this.currentBet + this.minRaise : this.bigBlind;
        const maxTarget = player.bet + player.stack;
        if (target > maxTarget) throw new Error('No tienes fichas suficientes');
        const allInShort = target === maxTarget && target < minTarget;
        if (target < minTarget && !allInShort) {
          throw new Error(`La subida mínima es ${minTarget}`);
        }
        const increment = target - this.currentBet;
        if (increment > 0) this.minRaise = Math.max(this.minRaise, increment);
        this.commit(player, target - player.bet);
        this.currentBet = Math.max(this.currentBet, player.bet);
        // Al subir, los demás vuelven a tener que hablar.
        for (const p of this.actors()) {
          if (p.seat !== seat) p.acted = false;
        }
        player.acted = true;
        this.lastAction = player.allIn
          ? `${player.username} va all-in con ${player.bet}`
          : `${player.username} sube a ${player.bet}`;
        break;
      }
      case 'all-in': {
        this.commit(player, player.stack);
        if (player.bet > this.currentBet) {
          const increment = player.bet - this.currentBet;
          this.minRaise = Math.max(this.minRaise, increment);
          this.currentBet = player.bet;
          for (const p of this.actors()) {
            if (p.seat !== seat) p.acted = false;
          }
        }
        player.acted = true;
        this.lastAction = `${player.username} va all-in con ${player.bet}`;
        break;
      }
      default:
        throw new Error('Acción desconocida');
    }

    this.advance();
    return this.publicState();
  }

  // Mete fichas al bote desde la pila de un jugador. Las monedas pagadas se
  // gastan primero (igual que en el monedero), para poder saber después qué
  // parte del bote es dinero real y qué parte es moneda de regalo.
  commit(player, amount) {
    const paid = Math.min(amount, player.stack);
    const fromPaid = Math.min(paid, player.paidStack);
    player.paidStack -= fromPaid;
    player.paidBet += fromPaid;
    player.stack -= paid;
    player.bet += paid;
    player.totalBet += paid;
    this.pot += paid;
    this.paidPot += fromPaid;
    if (player.stack === 0) player.allIn = true;
  }

  foldSeat(seat) {
    const p = this.seats[seat];
    p.folded = true;
    p.acted = true;
  }

  // ¿Terminó la ronda de apuestas? Lo está cuando todos los que pueden actuar
  // han hablado y han igualado la apuesta máxima.
  roundComplete() {
    const actors = this.actors();
    if (actors.length === 0) return true;
    return actors.every((p) => p.acted && p.bet === this.currentBet);
  }

  // Avanza la mano: o pasa a la siguiente fase o termina el showdown.
  advance() {
    // Si solo queda uno sin retirarse, gana el bote sin enseñar cartas.
    if (this.livePlayers().length <= 1) {
      this.finishWithoutShowdown();
      return;
    }
    if (!this.roundComplete()) {
      this.turnSeat = this.nextActor(this.turnSeat ?? 0);
      return;
    }
    // Ronda cerrada: se recogen las apuestas y se pasa de fase.
    this.collectBets();
    this.nextPhase();
  }

  collectBets() {
    for (const p of this.players()) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
  }

  nextPhase() {
    const order = ['preflop', 'flop', 'turn', 'river'];
    const idx = order.indexOf(this.phase);
    if (idx === -1 || idx === order.length - 1) {
      this.showdown();
      return;
    }
    const next = order[idx + 1];
    this.deck.burn();
    const need = BOARD_COUNT[next] - this.board.length;
    for (let i = 0; i < need; i += 1) this.board.push(this.deck.draw());
    this.phase = next;
    // Tras el flop habla el primero a la izquierda del botón que siga vivo.
    const first = this.nextOccupied(this.buttonSeat, { skipFolded: true });
    this.turnSeat = this.nextActor((first - 1 + this.maxSeats) % this.maxSeats);
    if (this.turnSeat === null) {
      // Todos all-in: se reparten las cartas que falten sin más apuestas.
      this.runOutBoard();
      return;
    }
    for (const p of this.players()) p.acted = false;
  }

  // Con todos all-in se reparten las cartas que faltan y se va al showdown.
  runOutBoard() {
    while (this.board.length < 5) {
      this.deck.burn();
      const next = ['flop', 'turn', 'river'].find((ph) => BOARD_COUNT[ph] > this.board.length);
      const need = BOARD_COUNT[next] - this.board.length;
      for (let i = 0; i < need; i += 1) this.board.push(this.deck.draw());
    }
    this.showdown();
  }

  finishWithoutShowdown() {
    const winner = this.livePlayers()[0];
    const rakeRate = this.rakeRate ?? 0;
    const house = Math.round(this.pot * rakeRate * 100) / 100;
    const amount = Math.round((this.pot - house) * 100) / 100;
    // El bote sin showdown también paga comisión, del tipo de moneda que puso el
    // ganador (pagada primero, como en `commit`).
    const paidRatio = this.pot > 0 ? Math.min(1, this.paidPot / this.pot) : 0;
    this.rake = {
      paid: Math.round(house * paidRatio * 100) / 100,
      bonus: Math.round(house * (1 - paidRatio) * 100) / 100,
    };
    // La parte pagada del premio sigue siendo dinero real en la pila.
    winner.paidStack = Math.round((winner.paidStack + amount * paidRatio) * 100) / 100;
    this.winners = [{ userId: winner.userId, username: winner.username, amount }];
    winner.stack += amount;
    winner.won = amount;
    this.lastAction = `${winner.username} gana el bote de ${amount}`;
    this.phase = 'showdown';
    this.turnSeat = null;
  }

  /* ---------------------------------------------------------------- */
  /* Showdown y botes                                                  */
  /* ---------------------------------------------------------------- */

  // Reparte el bote en botes laterales según lo que puso cada uno. Así, quien va
  // all-in por menos solo puede ganar la parte que cubrió. De cada nivel se
  // guarda además cuántas fichas son monedas pagadas, para poder cobrar la
  // comisión en el tipo de moneda correcto.
  buildPots() {
    const contributors = this.players()
      .filter((p) => p.totalBet > 0)
      .map((p) => ({ player: p, amount: p.totalBet, paid: p.paidBet }));
    const pots = [];
    let remaining = contributors;
    while (remaining.length > 0) {
      const min = Math.min(...remaining.map((r) => r.amount));
      const pot = { amount: 0, paidAmount: 0, eligible: [] };
      for (const r of remaining) {
        pot.amount += min;
        const paidPart = Math.min(min, r.paid);
        pot.paidAmount += paidPart;
        r.paid -= paidPart;
        r.amount -= min;
        if (!r.player.folded) pot.eligible.push(r.player);
      }
      pots.push(pot);
      remaining = remaining.filter((r) => r.amount > 0);
    }
    return pots;
  }

  /**
   * Reparte un bote entre sus ganadores, cobrando la comisión de la casa.
   *
   * La comisión se calcula por jugador y se queda en monedas del mismo tipo que
   * puso ese jugador: la parte pagada va a la casa como monedas pagadas (ingreso
   * real) y la parte de regalo como monedas de regalo. Así la casa nunca
   * convierte monedas de regalo en dinero, que es la regla del resto de la
   * economía. La comisión va en `pot.rakePaid` y `pot.rakeBonus`.
   *
   * `rakeRate` es la fracción que se queda la casa de cada bote. La comisión de
   * cada jugador se redondea hacia abajo al céntimo, así que nunca se paga de
   * más.
   */
  awardPot(pot, winners, rakeRate) {
    const totalRake = pot.rakeRate == null ? rakeRate : pot.rakeRate;
    const total = pot.amount;
    const house = round2(total * totalRake);
    const distributable = round2(total - house);
    if (distributable <= 0) return { paid: 0, bonus: 0, payouts: [] };

    // Cada ganador aporta a la comisión en proporción a lo que arriesgó.
    const paidContributed = pot.paidAmount || 0;
    const share = Math.floor((distributable * 100) / winners.length) / 100;
    let remainder = round2(distributable - share * winners.length);
    const payouts = [];
    for (const p of winners) {
      let amount = share;
      if (remainder >= 0.01) { amount = round2(amount + 0.01); remainder = round2(remainder - 0.01); }
      p.stack = round2(p.stack + amount);
      p.won = round2(p.won + amount);
      payouts.push({ player: p, amount });
    }

    // La comisión se reparte entre pagada y de regalo según lo que puso el bote.
    const paidRatio = total > 0 ? Math.min(1, paidContributed / total) : 0;
    // La parte pagada del premio vuelve a la pila como pagada: es dinero real que
    // el jugador sigue teniendo en fichas.
    for (const { player, amount } of payouts) {
      player.paidStack = round2(player.paidStack + amount * paidRatio);
    }
    const rakePaid = round2(house * paidRatio);
    const rakeBonus = round2(house - rakePaid);
    return { paid: rakePaid, bonus: rakeBonus, payouts };
  }

  showdown() {
    this.phase = 'showdown';
    this.turnSeat = null;
    const pots = this.buildPots();
    const winners = [];
    const rake = { paid: 0, bonus: 0 };
    const rakeRate = this.rakeRate ?? 0;

    for (const pot of pots) {
      if (pot.eligible.length === 0) continue;
      // Mejor mano entre los que pueden ganar este bote.
      let best = null;
      for (const p of pot.eligible) {
        const hand = bestHand(p.holeCards, this.board);
        p.handLabel = hand.label;
        if (!best || compareScores(hand.score, best.hand.score) > 0) {
          best = { hand, players: [p] };
        } else if (compareScores(hand.score, best.hand.score) === 0) {
          best.players.push(p);
        }
      }
      // Composición del bote por tipo de moneda (ya calculada en buildPots).
      pot.rakeRate = this.rakeRate ?? 0;
      const taken = this.awardPot(pot, best.players, rakeRate);
      rake.paid = round2(rake.paid + taken.paid);
      rake.bonus = round2(rake.bonus + taken.bonus);
      for (const p of best.players) {
        winners.push({ userId: p.userId, username: p.username, amount: p.won, hand: p.handLabel });
      }
    }

    // Los que llegaron al showdown y no ganaron también enseñan su mano.
    for (const p of this.livePlayers()) {
      if (!p.handLabel) p.handLabel = bestHand(p.holeCards, this.board).label;
    }

    this.winners = winners;
    this.rake = rake;
    const names = winners.map((w) => w.username).join(', ');
    this.lastAction = `Gana ${names}`;
  }

  /* ---------------------------------------------------------------- */
  /* Estado para el cliente                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Estado que puede ver un jugador. Las cartas de los demás solo se enseñan en
   * el showdown; hasta entonces van ocultas. Es la única salida que debe llegar
   * al cliente, para no filtrar manos por el socket.
   */
  publicState(forUserId = null) {
    const showAll = this.phase === 'showdown';
    return {
      id: this.id,
      hostId: this.hostId,
      phase: this.phase,
      handNumber: this.handNumber,
      board: this.board.map(cardLabel),
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      turnSeat: this.turnSeat,
      buttonSeat: this.buttonSeat,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      maxSeats: this.maxSeats,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      rakeRate: this.rakeRate,
      lastAction: this.lastAction,
      winners: this.winners,
      seats: this.seats.map((p, seat) => {
        if (!p) return { seat, empty: true };
        const isSelf = forUserId != null && String(p.userId) === String(forUserId);
        const reveal = isSelf || (showAll && !p.folded);
        return {
          seat,
          userId: p.userId,
          username: p.username,
          stack: p.stack,
          bet: p.bet,
          folded: p.folded,
          allIn: p.allIn,
          acted: p.acted,
          isSelf,
          isButton: seat === this.buttonSeat,
          // Solo se enseñan las cartas propias, o todas en el showdown.
          holeCards: reveal ? p.holeCards.map(cardLabel) : p.holeCards.map(() => null),
          holeCount: p.holeCards.length,
          handLabel: showAll ? p.handLabel : null,
        };
      }),
    };
  }
}

module.exports = { PokerTable, PHASES, BOARD_COUNT };
