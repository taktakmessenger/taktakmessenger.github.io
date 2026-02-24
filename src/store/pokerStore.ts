import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PokerRoom, Player, Card, GamePhase } from '@/utils/pokerLogic';
import { 
  createDeck, 
  shuffleDeck, 
  dealCards, 
  determineWinner,
  calculateAdminFee,
  calculateWinnerPrize,
  createPokerRoom
} from '@/utils/pokerLogic';

export interface PokerGameState {
  // Rooms
  rooms: PokerRoom[];
  currentRoom: PokerRoom | null;
  
  // Game State
  deck: Card[];
  gameLog: string[];
  handHistory: HandHistory[];
  
  // Admin Stats
  totalAdminEarnings: number;
  totalGamesPlayed: number;
  totalPotAmount: number;
  
  // Actions
  createRoom: (name: string, minBuyIn: number, maxBuyIn: number, smallBlind: number, bigBlind: number) => PokerRoom;
  joinRoom: (roomId: string, player: Player) => boolean;
  leaveRoom: (roomId: string, playerId: string) => void;
  startGame: (roomId: string) => void;
  playerAction: (roomId: string, playerId: string, action: 'fold' | 'check' | 'call' | 'raise', amount?: number) => void;
  nextPhase: (roomId: string) => void;
  endHand: (roomId: string) => void;
  resetRoom: (roomId: string) => void;
  setCurrentRoom: (room: PokerRoom | null) => void;
  
  // Getters
  getAvailableRooms: () => PokerRoom[];
  getRoomById: (roomId: string) => PokerRoom | undefined;
  getActivePlayerCount: (roomId: string) => number;
}

export interface HandHistory {
  id: string;
  roomId: string;
  roomName: string;
  timestamp: string;
  players: string[];
  winner: string;
  winningHand: string;
  pot: number;
  adminFee: number;
  communityCards: Card[];
}

// Predefined rooms
const defaultRooms: PokerRoom[] = [
  createPokerRoom('Mesa Principiante', 5, 50, 0.25, 0.50),
  createPokerRoom('Mesa Intermedia', 20, 200, 1, 2),
  createPokerRoom('Mesa Pro', 100, 1000, 5, 10),
  createPokerRoom('Mesa High Roller', 500, 5000, 25, 50),
];

export const usePokerStore = create<PokerGameState>()(
  persist(
    (set, get) => ({
      // Initial State
      rooms: defaultRooms,
      currentRoom: null,
      deck: [],
      gameLog: [],
      handHistory: [],
      totalAdminEarnings: 0,
      totalGamesPlayed: 0,
      totalPotAmount: 0,

      // Create a new room
      createRoom: (name, minBuyIn, maxBuyIn, smallBlind, bigBlind) => {
        const newRoom = createPokerRoom(name, minBuyIn, maxBuyIn, smallBlind, bigBlind);
        set(state => ({ rooms: [...state.rooms, newRoom] }));
        return newRoom;
      },

      // Join a room
      joinRoom: (roomId, player) => {
        const room = get().rooms.find(r => r.id === roomId);
        if (!room) return false;
        if (room.players.length >= room.maxPlayers) return false;
        if (room.players.find(p => p.id === player.id)) return false;
        
        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { ...r, players: [...r.players, { ...player, isActive: true }] }
              : r
          )
        }));
        return true;
      },

      // Leave a room
      leaveRoom: (roomId, playerId) => {
        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { ...r, players: r.players.filter(p => p.id !== playerId) }
              : r
          ),
          currentRoom: state.currentRoom?.id === roomId 
            ? { ...state.currentRoom, players: state.currentRoom.players.filter(p => p.id !== playerId) }
            : state.currentRoom
        }));
      },

      // Start a new game/hand
      startGame: (roomId) => {
        const room = get().rooms.find(r => r.id === roomId);
        if (!room || room.players.length < 2) return;

        const shuffledDeck = shuffleDeck(createDeck());
        const { deck: remainingDeck, players: dealtPlayers } = dealCards(shuffledDeck, room.players);

        // Set blinds
        const dealerPos = (room.dealerPosition + 1) % dealtPlayers.length;
        const smallBlindPos = (dealerPos + 1) % dealtPlayers.length;
        const bigBlindPos = (dealerPos + 2) % dealtPlayers.length;

        const playersWithBlinds = dealtPlayers.map((p, i) => ({
          ...p,
          isDealer: i === dealerPos,
          isSmallBlind: i === smallBlindPos,
          isBigBlind: i === bigBlindPos,
          currentBet: i === smallBlindPos ? room.smallBlind : i === bigBlindPos ? room.bigBlind : 0,
          hasFolded: false,
          hasActed: false,
          chips: p.chips - (i === smallBlindPos ? room.smallBlind : i === bigBlindPos ? room.bigBlind : 0)
        }));

        const initialPot = room.smallBlind + room.bigBlind;

        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { 
                  ...r, 
                  players: playersWithBlinds,
                  communityCards: [],
                  pot: initialPot,
                  phase: 'preflop',
                  dealerPosition: dealerPos,
                  currentPlayerIndex: (bigBlindPos + 1) % playersWithBlinds.length,
                  currentBet: room.bigBlind
                }
              : r
          ),
          currentRoom: state.currentRoom?.id === roomId 
            ? { 
                ...state.currentRoom, 
                players: playersWithBlinds,
                communityCards: [],
                pot: initialPot,
                phase: 'preflop',
                dealerPosition: dealerPos,
                currentPlayerIndex: (bigBlindPos + 1) % playersWithBlinds.length,
                currentBet: room.bigBlind
              }
            : state.currentRoom,
          deck: remainingDeck,
          gameLog: [`🎮 Nueva mano iniciada en ${room.name}`, `💰 Pot inicial: $${initialPot}`]
        }));
      },

      // Player action
      playerAction: (roomId, playerId, action, amount) => {
        const room = get().rooms.find(r => r.id === roomId);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return;
        if (playerIndex !== room.currentPlayerIndex) return;

        const player = room.players[playerIndex];
        let updatedPlayers = [...room.players];
        let updatedPot = room.pot;
        let updatedCurrentBet = room.currentBet;
        let logMessage = '';

        switch (action) {
          case 'fold':
            updatedPlayers[playerIndex] = { ...player, hasFolded: true, hasActed: true };
            logMessage = `📤 ${player.username} se retira`;
            break;

          case 'check':
            if (player.currentBet < room.currentBet) return;
            updatedPlayers[playerIndex] = { ...player, hasActed: true };
            logMessage = `✓ ${player.username} pasa`;
            break;

          case 'call':
            const callAmount = room.currentBet - player.currentBet;
            if (player.chips < callAmount) return;
            updatedPlayers[playerIndex] = { 
              ...player, 
              chips: player.chips - callAmount,
              currentBet: room.currentBet,
              hasActed: true
            };
            updatedPot += callAmount;
            logMessage = `📞 ${player.username} iguala $${callAmount}`;
            break;

          case 'raise':
            if (!amount || amount <= room.currentBet) return;
            const raiseAmount = amount - player.currentBet;
            if (player.chips < raiseAmount) return;
            updatedPlayers[playerIndex] = { 
              ...player, 
              chips: player.chips - raiseAmount,
              currentBet: amount,
              hasActed: true
            };
            updatedPot += raiseAmount;
            updatedCurrentBet = amount;
            // Reset hasActed for other players
            updatedPlayers = updatedPlayers.map((p, i) => 
              i !== playerIndex ? { ...p, hasActed: false } : p
            );
            logMessage = `⬆️ ${player.username} sube a $${amount}`;
            break;
        }

        // Find next active player
        let nextPlayerIndex = (playerIndex + 1) % updatedPlayers.length;
        let loopCount = 0;
        while (
          (updatedPlayers[nextPlayerIndex].hasFolded || 
           (updatedPlayers[nextPlayerIndex].hasActed && updatedPlayers[nextPlayerIndex].currentBet === updatedCurrentBet)) &&
          loopCount < updatedPlayers.length
        ) {
          nextPlayerIndex = (nextPlayerIndex + 1) % updatedPlayers.length;
          loopCount++;
        }

        // Check if all active players have acted
        const activePlayers = updatedPlayers.filter(p => !p.hasFolded);
        const allActed = activePlayers.every(p => p.hasActed && p.currentBet === updatedCurrentBet);

        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { 
                  ...r, 
                  players: updatedPlayers,
                  pot: updatedPot,
                  currentBet: updatedCurrentBet,
                  currentPlayerIndex: allActed ? r.currentPlayerIndex : nextPlayerIndex
                }
              : r
          ),
          currentRoom: state.currentRoom?.id === roomId 
            ? { 
                ...state.currentRoom, 
                players: updatedPlayers,
                pot: updatedPot,
                currentBet: updatedCurrentBet,
                currentPlayerIndex: allActed ? state.currentRoom.currentPlayerIndex : nextPlayerIndex
              }
            : state.currentRoom,
          gameLog: [...get().gameLog, logMessage]
        }));

        // Auto-advance to next phase if all players have acted
        if (allActed) {
          setTimeout(() => get().nextPhase(roomId), 1000);
        }
      },

      // Advance to next phase
      nextPhase: (roomId) => {
        const room = get().rooms.find(r => r.id === roomId);
        if (!room) return;

        let newPhase: GamePhase = room.phase;
        let newCommunityCards = [...room.communityCards];
        let newDeck = [...get().deck];
        let logMessage = '';

        switch (room.phase) {
          case 'preflop':
            newPhase = 'flop';
            newCommunityCards = [newDeck.pop()!, newDeck.pop()!, newDeck.pop()!];
            logMessage = `🃏 Flop: ${newCommunityCards.map(c => c.rank + c.suit[0]).join(' ')}`;
            break;
          case 'flop':
            newPhase = 'turn';
            newCommunityCards = [...newCommunityCards, newDeck.pop()!];
            logMessage = `🃏 Turn: ${newCommunityCards.map(c => c.rank + c.suit[0]).join(' ')}`;
            break;
          case 'turn':
            newPhase = 'river';
            newCommunityCards = [...newCommunityCards, newDeck.pop()!];
            logMessage = `🃏 River: ${newCommunityCards.map(c => c.rank + c.suit[0]).join(' ')}`;
            break;
          case 'river':
            newPhase = 'showdown';
            logMessage = `🏆 ¡Showdown!`;
            setTimeout(() => get().endHand(roomId), 2000);
            break;
        }

        // Reset player bets and hasActed for new phase
        const resetPlayers = room.players.map(p => ({
          ...p,
          currentBet: 0,
          hasActed: false
        }));

        // Find first active player after dealer
        let firstActiveIndex = (room.dealerPosition + 1) % resetPlayers.length;
        while (resetPlayers[firstActiveIndex].hasFolded) {
          firstActiveIndex = (firstActiveIndex + 1) % resetPlayers.length;
        }

        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { 
                  ...r, 
                  phase: newPhase,
                  communityCards: newCommunityCards,
                  players: resetPlayers,
                  currentPlayerIndex: firstActiveIndex,
                  currentBet: 0
                }
              : r
          ),
          currentRoom: state.currentRoom?.id === roomId 
            ? { 
                ...state.currentRoom, 
                phase: newPhase,
                communityCards: newCommunityCards,
                players: resetPlayers,
                currentPlayerIndex: firstActiveIndex,
                currentBet: 0
              }
            : state.currentRoom,
          deck: newDeck,
          gameLog: [...get().gameLog, logMessage]
        }));
      },

      // End hand and determine winner
      endHand: (roomId) => {
        const room = get().rooms.find(r => r.id === roomId);
        if (!room) return;

        const winners = determineWinner(room.players, room.communityCards);
        const adminFee = calculateAdminFee(room.pot);
        const winnerPrize = calculateWinnerPrize(room.pot);
        const prizePerWinner = Math.floor(winnerPrize / winners.length);

        // Update winner chips
        const updatedPlayers = room.players.map(p => {
          if (winners.find(w => w.id === p.id)) {
            return { ...p, chips: p.chips + prizePerWinner };
          }
          return p;
        });

        const winnerNames = winners.map(w => w.username).join(', ');
        const handResult = winners.length > 0 
          ? determineWinner([winners[0]], room.communityCards)
          : null;

        // Add to hand history
        const handHistory: HandHistory = {
          id: Math.random().toString(36).substring(2, 15),
          roomId: room.id,
          roomName: room.name,
          timestamp: new Date().toISOString(),
          players: room.players.map(p => p.username),
          winner: winnerNames,
          winningHand: handResult?.[0]?.cards ? 'Ganador' : 'Desconocido',
          pot: room.pot,
          adminFee: adminFee,
          communityCards: room.communityCards
        };

        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { ...r, players: updatedPlayers }
              : r
          ),
          currentRoom: state.currentRoom?.id === roomId 
            ? { ...state.currentRoom, players: updatedPlayers }
            : state.currentRoom,
          handHistory: [handHistory, ...state.handHistory],
          totalAdminEarnings: state.totalAdminEarnings + adminFee,
          totalGamesPlayed: state.totalGamesPlayed + 1,
          totalPotAmount: state.totalPotAmount + room.pot,
          gameLog: [
            ...get().gameLog,
            `🏆 Ganador${winners.length > 1 ? 'es' : ''}: ${winnerNames}`,
            `💰 Premio: $${prizePerWinner} cada uno`,
            `👑 Comisión admin: $${adminFee}`,
            `🎮 Mano finalizada`
          ]
        }));
      },

      // Reset room for new hand
      resetRoom: (roomId) => {
        const room = get().rooms.find(r => r.id === roomId);
        if (!room) return;

        set(state => ({
          rooms: state.rooms.map(r => 
            r.id === roomId 
              ? { 
                  ...r, 
                  communityCards: [],
                  pot: 0,
                  phase: 'waiting',
                  currentBet: 0,
                  players: r.players.map(p => ({
                    ...p,
                    cards: [],
                    currentBet: 0,
                    hasFolded: false,
                    hasActed: false,
                    isDealer: false,
                    isSmallBlind: false,
                    isBigBlind: false
                  }))
                }
              : r
          ),
          currentRoom: state.currentRoom?.id === roomId 
            ? { 
                ...state.currentRoom, 
                communityCards: [],
                pot: 0,
                phase: 'waiting',
                currentBet: 0,
                players: state.currentRoom.players.map(p => ({
                  ...p,
                  cards: [],
                  currentBet: 0,
                  hasFolded: false,
                  hasActed: false,
                  isDealer: false,
                  isSmallBlind: false,
                  isBigBlind: false
                }))
              }
            : state.currentRoom
        }));
      },

      // Set current room
      setCurrentRoom: (room) => {
        set({ currentRoom: room });
      },

      // Get available rooms
      getAvailableRooms: () => {
        return get().rooms.filter(r => r.players.length < r.maxPlayers);
      },

      // Get room by ID
      getRoomById: (roomId) => {
        return get().rooms.find(r => r.id === roomId);
      },

      // Get active player count
      getActivePlayerCount: (roomId) => {
        const room = get().rooms.find(r => r.id === roomId);
        return room ? room.players.filter(p => !p.hasFolded).length : 0;
      }
    }),
    {
      name: 'taktak-poker-storage',
      partialize: (state) => ({ 
        rooms: state.rooms,
        handHistory: state.handHistory,
        totalAdminEarnings: state.totalAdminEarnings,
        totalGamesPlayed: state.totalGamesPlayed,
        totalPotAmount: state.totalPotAmount
      })
    }
  )
);
