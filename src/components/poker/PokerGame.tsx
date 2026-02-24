import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, DollarSign, Play,
  MessageSquare, History, TrendingUp,
  ChevronLeft, Plus, Minus
} from 'lucide-react';
import { usePokerStore } from '@/store/pokerStore';
import { useStore } from '@/store/useStore';
import { Card, CardBack } from './Card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Player } from '@/utils/pokerLogic';

interface PokerGameProps {
  onBack: () => void;
}

export const PokerGame = ({ onBack }: PokerGameProps) => {
  const {
    currentRoom,
    setCurrentRoom,
    joinRoom,
    leaveRoom,
    startGame,
    playerAction,
    gameLog,
    handHistory
  } = usePokerStore();
  const { currentUser, balance, addBalance } = useStore();

  const [showChat, setShowChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);

  // Check if current user is in the room
  const currentPlayer = currentRoom?.players.find(p => p.id === currentUser?.id);
  const isMyTurn = currentRoom?.currentPlayerIndex === currentRoom?.players.findIndex(p => p.id === currentUser?.id);
  const canAct = isMyTurn && currentPlayer && !currentPlayer.hasFolded && currentRoom?.phase !== 'waiting' && currentRoom?.phase !== 'showdown';

  const handleJoin = () => {
    if (!currentRoom || !currentUser) return;

    if (balance < currentRoom.minBuyIn) {
      toast.error(`Necesitas al menos $${currentRoom.minBuyIn} para unirte`);
      return;
    }

    const player: Player = {
      id: currentUser.id,
      username: currentUser.username,
      avatar: currentUser.avatar,
      chips: currentRoom.minBuyIn,
      cards: [],
      isActive: true,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      currentBet: 0,
      hasFolded: false,
      hasActed: false
    };

    if (joinRoom(currentRoom.id, player)) {
      addBalance(-currentRoom.minBuyIn);
      toast.success(`¡Te uniste a ${currentRoom.name}!`);
    }
  };

  const handleLeave = () => {
    if (!currentRoom || !currentUser) return;

    const player = currentRoom.players.find(p => p.id === currentUser.id);
    if (player) {
      addBalance(player.chips);
    }

    leaveRoom(currentRoom.id, currentUser.id);
    setCurrentRoom(null);
    onBack();
  };

  const handleStartGame = () => {
    if (!currentRoom) return;
    if (currentRoom.players.length < 2) {
      toast.error('Se necesitan al menos 2 jugadores');
      return;
    }
    startGame(currentRoom.id);
  };

  const handleAction = (action: 'fold' | 'check' | 'call' | 'raise') => {
    if (!currentRoom || !canAct) return;

    if (action === 'raise' && raiseAmount <= currentRoom.currentBet) {
      toast.error('La subida debe ser mayor que la apuesta actual');
      return;
    }

    playerAction(currentRoom.id, currentUser!.id, action, action === 'raise' ? raiseAmount : undefined);
    setRaiseAmount(0);
  };

  const adjustRaise = (amount: number) => {
    if (!currentRoom || !currentPlayer) return;
    const newAmount = raiseAmount + amount;
    if (newAmount >= currentRoom.currentBet * 2 && newAmount <= currentPlayer.chips) {
      setRaiseAmount(newAmount);
    }
  };

  if (!currentRoom) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white p-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">No hay sala seleccionada</h2>
          <Button onClick={onBack}>Volver a salas</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button onClick={handleLeave} className="p-2 hover:bg-zinc-800 rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="font-bold text-lg">{currentRoom.name}</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Users className="w-4 h-4" />
              <span>{currentRoom.players.length}/{currentRoom.maxPlayers}</span>
              <span className="mx-2">•</span>
              <DollarSign className="w-4 h-4" />
              <span>BB: ${currentRoom.bigBlind}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right mr-4">
            <p className="text-sm text-zinc-400">Tu saldo</p>
            <p className="font-bold text-green-400">${currentPlayer?.chips || 0}</p>
          </div>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-2 rounded-full ${showChat ? 'bg-purple-500' : 'hover:bg-zinc-800'}`}
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-2 rounded-full ${showHistory ? 'bg-purple-500' : 'hover:bg-zinc-800'}`}
          >
            <History className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Game Table */}
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          {/* Pot Display */}
          <motion.div
            key={currentRoom.pot}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="mb-8 px-6 py-3 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 rounded-full border border-yellow-500/50"
          >
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-yellow-400" />
              <span className="text-2xl font-bold text-yellow-400">${currentRoom.pot}</span>
            </div>
            <p className="text-xs text-yellow-400/70 text-center">Bote total</p>
          </motion.div>

          {/* Community Cards */}
          <div className="flex gap-2 mb-12">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: -20 }}
                animate={{
                  opacity: currentRoom.communityCards[i] ? 1 : 0.3,
                  y: 0
                }}
                transition={{ delay: i * 0.1 }}
              >
                {currentRoom.communityCards[i] ? (
                  <Card card={currentRoom.communityCards[i]} size="lg" />
                ) : (
                  <CardBack size="lg" />
                )}
              </motion.div>
            ))}
          </div>

          {/* Players */}
          <div className="grid grid-cols-3 gap-8 w-full max-w-4xl">
            {currentRoom.players.map((player, index) => (
              <motion.div
                key={player.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className={`
                  relative p-4 rounded-xl border-2
                  ${player.id === currentUser?.id ? 'border-purple-500 bg-purple-500/10' : 'border-zinc-700 bg-zinc-800/50'}
                  ${player.hasFolded ? 'opacity-50' : ''}
                  ${currentRoom.currentPlayerIndex === index ? 'ring-2 ring-yellow-400' : ''}
                `}
              >
                {/* Player Position Badge */}
                {player.isDealer && (
                  <span className="absolute -top-2 -right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-xs font-bold">
                    D
                  </span>
                )}
                {player.isSmallBlind && (
                  <span className="absolute -top-2 -right-2 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center text-xs font-bold text-black">
                    SB
                  </span>
                )}
                {player.isBigBlind && (
                  <span className="absolute -top-2 -right-2 w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold">
                    BB
                  </span>
                )}

                <div className="flex items-center gap-3 mb-2">
                  <img src={player.avatar} alt={player.username} className="w-10 h-10 rounded-full" />
                  <div>
                    <p className="font-medium text-sm">{player.username}</p>
                    <p className="text-xs text-zinc-400">${player.chips}</p>
                  </div>
                </div>

                {/* Player Cards */}
                <div className="flex gap-1 justify-center">
                  {player.id === currentUser?.id ? (
                    // Show own cards
                    player.cards.map((card, i) => (
                      <Card key={i} card={card} size="sm" />
                    ))
                  ) : (
                    // Show card backs for others
                    <>
                      <CardBack size="sm" />
                      <CardBack size="sm" />
                    </>
                  )}
                </div>

                {/* Current Bet */}
                {player.currentBet > 0 && (
                  <div className="mt-2 text-center">
                    <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">
                      ${player.currentBet}
                    </span>
                  </div>
                )}

                {player.hasFolded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                    <span className="text-red-400 font-bold">RETIRADO</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Game Phase Indicator */}
          <div className="mt-8 px-4 py-2 bg-zinc-800 rounded-full">
            <span className="text-zinc-400 text-sm uppercase tracking-wider">
              {currentRoom.phase === 'waiting' && 'Esperando jugadores...'}
              {currentRoom.phase === 'preflop' && 'Pre-Flop'}
              {currentRoom.phase === 'flop' && 'Flop'}
              {currentRoom.phase === 'turn' && 'Turn'}
              {currentRoom.phase === 'river' && 'River'}
              {currentRoom.phase === 'showdown' && 'Showdown!'}
            </span>
          </div>
        </div>

        {/* Side Panel - Chat/History */}
        <AnimatePresence>
          {(showChat || showHistory) && (
            <motion.div
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col"
            >
              {showChat && (
                <>
                  <div className="p-4 border-b border-zinc-800">
                    <h3 className="font-semibold flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Chat de la mesa
                    </h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {gameLog.map((log, i) => (
                      <p key={i} className="text-sm text-zinc-400">{log}</p>
                    ))}
                  </div>
                </>
              )}

              {showHistory && (
                <>
                  <div className="p-4 border-b border-zinc-800">
                    <h3 className="font-semibold flex items-center gap-2">
                      <History className="w-4 h-4" />
                      Historial
                    </h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {handHistory.slice(0, 10).map((hand) => (
                      <div key={hand.id} className="p-3 bg-zinc-800 rounded-lg text-sm">
                        <p className="text-zinc-400">{new Date(hand.timestamp).toLocaleTimeString()}</p>
                        <p className="font-medium">Ganador: {hand.winner}</p>
                        <p className="text-green-400">Pot: ${hand.pot}</p>

                      </div>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action Bar */}
      <div className="p-4 bg-zinc-900 border-t border-zinc-800">
        {!currentPlayer ? (
          // Not joined - Show join button
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={handleJoin}
              className="bg-gradient-to-r from-green-500 to-emerald-500 px-8"
            >
              <Plus className="w-5 h-5 mr-2" />
              Unirse con ${currentRoom.minBuyIn}
            </Button>
          </div>
        ) : currentRoom.phase === 'waiting' ? (
          // Waiting to start
          <div className="flex justify-center gap-4">
            <Button
              size="lg"
              onClick={handleStartGame}
              disabled={currentRoom.players.length < 2}
              className="bg-gradient-to-r from-purple-500 to-pink-500 px-8"
            >
              <Play className="w-5 h-5 mr-2" />
              Iniciar Juego
            </Button>
          </div>
        ) : (
          // Game actions
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {canAct && currentRoom.currentBet > currentPlayer.currentBet && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => handleAction('fold')}
                    className="border-red-500 text-red-400 hover:bg-red-500/20"
                  >
                    Retirarse
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleAction('call')}
                    className="border-blue-500 text-blue-400 hover:bg-blue-500/20"
                  >
                    Igualar ${currentRoom.currentBet - currentPlayer.currentBet}
                  </Button>
                </>
              )}

              {canAct && currentRoom.currentBet === currentPlayer.currentBet && (
                <Button
                  variant="outline"
                  onClick={() => handleAction('check')}
                  className="border-zinc-500 text-zinc-400 hover:bg-zinc-500/20"
                >
                  Pasar
                </Button>
              )}
            </div>

            {canAct && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
                  <button
                    onClick={() => adjustRaise(-currentRoom.bigBlind)}
                    className="p-2 hover:bg-zinc-700 rounded"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-16 text-center font-mono">${raiseAmount}</span>
                  <button
                    onClick={() => adjustRaise(currentRoom.bigBlind)}
                    className="p-2 hover:bg-zinc-700 rounded"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <Button
                  onClick={() => handleAction('raise')}
                  disabled={raiseAmount <= currentRoom.currentBet || raiseAmount > currentPlayer.chips}
                  className="bg-gradient-to-r from-orange-500 to-red-500"
                >
                  <TrendingUp className="w-4 h-4 mr-1" />
                  Subir
                </Button>
              </div>
            )}

            {!canAct && (
              <p className="text-zinc-500">
                {currentPlayer.hasFolded ? 'Te has retirado' : 'Esperando a otros jugadores...'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
