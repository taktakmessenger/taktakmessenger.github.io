/**
 * Lógica del Juego de Poker - Texas Hold'em
 * TakTak Poker System
 */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
}

export interface Player {
  id: string;
  username: string;
  avatar: string;
  chips: number;
  cards: Card[];
  isActive: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  currentBet: number;
  hasFolded: boolean;
  hasActed: boolean;
}

export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PokerRoom {
  id: string;
  name: string;
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number;
  players: Player[];
  communityCards: Card[];
  pot: number;
  phase: GamePhase;
  dealerPosition: number;
  currentPlayerIndex: number;
  currentBet: number;
  roomFee: number; // fee for admin
}

export type HandRank = 
  | 'high_card' 
  | 'pair' 
  | 'two_pair' 
  | 'three_of_a_kind' 
  | 'straight' 
  | 'flush' 
  | 'full_house' 
  | 'four_of_a_kind' 
  | 'straight_flush' 
  | 'royal_flush';

export interface HandResult {
  rank: HandRank;
  value: number;
  cards: Card[];
  description: string;
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const HAND_RANK_VALUES: Record<HandRank, number> = {
  'high_card': 1,
  'pair': 2,
  'two_pair': 3,
  'three_of_a_kind': 4,
  'straight': 5,
  'flush': 6,
  'full_house': 7,
  'four_of_a_kind': 8,
  'straight_flush': 9,
  'royal_flush': 10
};

/**
 * Crea una baraja completa de 52 cartas
 */
export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        suit,
        rank,
        value: RANK_VALUES[rank]
      });
    }
  }
  return deck;
};

/**
 * Baraja las cartas (Fisher-Yates shuffle)
 */
export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Reparte cartas a los jugadores
 */
export const dealCards = (deck: Card[], players: Player[]): { deck: Card[]; players: Player[] } => {
  const newDeck = [...deck];
  const updatedPlayers = players.map(player => ({
    ...player,
    cards: [newDeck.pop()!, newDeck.pop()!]
  }));
  return { deck: newDeck, players: updatedPlayers };
};

/**
 * Evalúa la mejor mano de 5 cartas de 7 cartas totales
 */
export const evaluateHand = (holeCards: Card[], communityCards: Card[]): HandResult => {
  const allCards = [...holeCards, ...communityCards];
  const combinations = getCombinations(allCards, 5);
  
  let bestHand: HandResult = {
    rank: 'high_card',
    value: 0,
    cards: [],
    description: 'Carta alta'
  };

  for (const combo of combinations) {
    const result = evaluateFiveCardHand(combo);
    if (result.value > bestHand.value) {
      bestHand = result;
    }
  }

  return bestHand;
};

/**
 * Evalúa una mano de 5 cartas
 */
const evaluateFiveCardHand = (cards: Card[]): HandResult => {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const isFlush = checkFlush(sorted);
  const isStraight = checkStraight(sorted);
  const counts = getRankCounts(sorted);

  // Royal Flush
  if (isFlush && isStraight && sorted[0].value === 14) {
    return {
      rank: 'royal_flush',
      value: HAND_RANK_VALUES.royal_flush * 1000000 + sorted[0].value,
      cards: sorted,
      description: '¡Escalera Real!'
    };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return {
      rank: 'straight_flush',
      value: HAND_RANK_VALUES.straight_flush * 1000000 + sorted[0].value,
      cards: sorted,
      description: 'Escalera de Color'
    };
  }

  // Four of a Kind
  const fourOfAKind = Object.entries(counts).find(([_, count]) => count === 4);
  if (fourOfAKind) {
    const kicker = sorted.find(c => c.value !== parseInt(fourOfAKind[0]))!;
    return {
      rank: 'four_of_a_kind',
      value: HAND_RANK_VALUES.four_of_a_kind * 1000000 + parseInt(fourOfAKind[0]) * 100 + kicker.value,
      cards: sorted,
      description: 'Póker de ' + getRankName(parseInt(fourOfAKind[0]))
    };
  }

  // Full House
  const threeOfAKind = Object.entries(counts).find(([_, count]) => count === 3);
  const pair = Object.entries(counts).find(([_, count]) => count === 2);
  if (threeOfAKind && pair) {
    return {
      rank: 'full_house',
      value: HAND_RANK_VALUES.full_house * 1000000 + parseInt(threeOfAKind[0]) * 100 + parseInt(pair[0]),
      cards: sorted,
      description: 'Full House'
    };
  }

  // Flush
  if (isFlush) {
    return {
      rank: 'flush',
      value: HAND_RANK_VALUES.flush * 1000000 + sorted[0].value * 10000 + sorted[1].value * 100 + sorted[2].value,
      cards: sorted,
      description: 'Color'
    };
  }

  // Straight
  if (isStraight) {
    return {
      rank: 'straight',
      value: HAND_RANK_VALUES.straight * 1000000 + sorted[0].value,
      cards: sorted,
      description: 'Escalera'
    };
  }

  // Three of a Kind
  if (threeOfAKind) {
    const kickers = sorted.filter(c => c.value !== parseInt(threeOfAKind[0])).slice(0, 2);
    return {
      rank: 'three_of_a_kind',
      value: HAND_RANK_VALUES.three_of_a_kind * 1000000 + parseInt(threeOfAKind[0]) * 100 + kickers[0].value,
      cards: sorted,
      description: 'Trío de ' + getRankName(parseInt(threeOfAKind[0]))
    };
  }

  // Two Pair
  const pairs = Object.entries(counts).filter(([_, count]) => count === 2);
  if (pairs.length === 2) {
    const highPair = Math.max(parseInt(pairs[0][0]), parseInt(pairs[1][0]));
    const lowPair = Math.min(parseInt(pairs[0][0]), parseInt(pairs[1][0]));
    const kicker = sorted.find(c => c.value !== highPair && c.value !== lowPair)!;
    return {
      rank: 'two_pair',
      value: HAND_RANK_VALUES.two_pair * 1000000 + highPair * 1000 + lowPair * 10 + kicker.value,
      cards: sorted,
      description: 'Doble Pareja'
    };
  }

  // Pair
  if (pair) {
    const kickers = sorted.filter(c => c.value !== parseInt(pair[0])).slice(0, 3);
    return {
      rank: 'pair',
      value: HAND_RANK_VALUES.pair * 1000000 + parseInt(pair[0]) * 1000 + kickers[0].value * 10 + kickers[1].value,
      cards: sorted,
      description: 'Pareja de ' + getRankName(parseInt(pair[0]))
    };
  }

  // High Card
  return {
    rank: 'high_card',
    value: sorted[0].value * 10000 + sorted[1].value * 100 + sorted[2].value,
    cards: sorted,
    description: 'Carta alta ' + getRankName(sorted[0].value)
  };
};

/**
 * Verifica si hay color
 */
const checkFlush = (cards: Card[]): boolean => {
  const suits: Record<string, number> = {};
  for (const card of cards) {
    suits[card.suit] = (suits[card.suit] || 0) + 1;
  }
  return Object.values(suits).some(count => count >= 5);
};

/**
 * Verifica si hay escalera
 */
const checkStraight = (cards: Card[]): boolean => {
  const uniqueValues = [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);
  
  // Check normal straight
  for (let i = 0; i <= uniqueValues.length - 5; i++) {
    if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
      return true;
    }
  }
  
  // Check A-5 straight (wheel)
  if (uniqueValues.includes(14) && uniqueValues.includes(5) && 
      uniqueValues.includes(4) && uniqueValues.includes(3) && uniqueValues.includes(2)) {
    return true;
  }
  
  return false;
};

/**
 * Cuenta las ocurrencias de cada rank
 */
const getRankCounts = (cards: Card[]): Record<number, number> => {
  const counts: Record<number, number> = {};
  for (const card of cards) {
    counts[card.value] = (counts[card.value] || 0) + 1;
  }
  return counts;
};

/**
 * Obtiene todas las combinaciones de k elementos de un array
 */
const getCombinations = <T,>(array: T[], k: number): T[][] => {
  if (k === 0) return [[]];
  if (array.length < k) return [];
  
  const result: T[][] = [];
  
  function backtrack(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    
    for (let i = start; i < array.length; i++) {
      current.push(array[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  
  backtrack(0, []);
  return result;
};

/**
 * Obtiene el nombre de un rank
 */
const getRankName = (value: number): string => {
  const names: Record<number, string> = {
    14: 'As', 13: 'Rey', 12: 'Reina', 11: 'Jota',
    10: '10', 9: '9', 8: '8', 7: '7', 6: '6',
    5: '5', 4: '4', 3: '3', 2: '2'
  };
  return names[value] || value.toString();
};

/**
 * Determina el ganador de una mano
 */
export const determineWinner = (players: Player[], communityCards: Card[]): Player[] => {
  const activePlayers = players.filter(p => !p.hasFolded);
  
  if (activePlayers.length === 1) {
    return activePlayers;
  }

  const playerHands = activePlayers.map(player => ({
    player,
    hand: evaluateHand(player.cards, communityCards)
  }));

  playerHands.sort((a, b) => b.hand.value - a.hand.value);

  // Check for tie
  const winners = playerHands.filter(h => h.hand.value === playerHands[0].hand.value);
  return winners.map(w => w.player);
};

/**
 * Obtiene el símbolo de un palo
 */
export const getSuitSymbol = (suit: Suit): string => {
  const symbols: Record<Suit, string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };
  return symbols[suit];
};

/**
 * Obtiene el color de un palo
 */
export const getSuitColor = (suit: Suit): string => {
  return suit === 'hearts' || suit === 'diamonds' ? 'text-red-500' : 'text-zinc-700';
};

/**
 * Crea una nueva sala de poker
 */
export const createPokerRoom = (
  name: string,
  minBuyIn: number,
  maxBuyIn: number,
  smallBlind: number,
  bigBlind: number
): PokerRoom => ({
  id: Math.random().toString(36).substring(2, 15),
  name,
  minBuyIn,
  maxBuyIn,
  smallBlind,
  bigBlind,
  maxPlayers: 9,
  players: [],
  communityCards: [],
  pot: 0,
  phase: 'waiting',
  dealerPosition: 0,
  currentPlayerIndex: 0,
  currentBet: 0,
  roomFee: 0.30
});

/**
 * Calcula las ganancias del admin
 */
export const calculateAdminFee = (pot: number): number => {
  return Math.floor(pot * 0.30);
};

/**
 * Calcula las ganancias del ganador
 */
export const calculateWinnerPrize = (pot: number): number => {
  return Math.floor(pot * 0.70);
};
