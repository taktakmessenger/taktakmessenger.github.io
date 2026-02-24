import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, DollarSign, TrendingUp, Plus,
  Clock, ChevronRight, Search, ArrowLeft
} from 'lucide-react';
import { usePokerStore } from '@/store/pokerStore';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { PokerRoom } from '@/utils/pokerLogic';

interface PokerLobbyProps {
  onJoinRoom: (room: PokerRoom) => void;
}

export const PokerLobby = ({ onJoinRoom }: PokerLobbyProps) => {
  const { rooms, totalGamesPlayed, handHistory } = usePokerStore();
  const { currentUser, setCurrentTab } = useStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRooms = rooms.filter(room =>
    room.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = [
    { label: 'Salas activas', value: rooms.length, icon: Users },
    { label: 'Manos jugadas', value: totalGamesPlayed, icon: TrendingUp },
    { label: 'Tu historial', value: handHistory.filter(h => h.players.includes(currentUser?.username || '')).length, icon: Clock },
  ];

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-y-auto hide-scrollbar pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentTab('home')}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
              title="Volver al inicio"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <h1 className="text-2xl font-bold gradient-text">TakTak Poker</h1>
              <p className="text-zinc-400 text-sm">Texas Hold'em en tiempo real</p>
            </div>
          </div>

        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-3 bg-zinc-800/50 rounded-xl"
            >
              <stat.icon className="w-5 h-5 text-purple-400 mb-1" />
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-zinc-400">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>



      {/* Search */}
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar salas..."
            className="pl-10 bg-zinc-800 border-zinc-700 text-white"
          />
        </div>
      </div>

      {/* Rooms List */}
      <div className="px-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Mesas disponibles</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast.info('Crear sala próximamente')}
          >
            <Plus className="w-4 h-4 mr-1" />
            Crear
          </Button>
        </div>

        {filteredRooms.map((room, index) => (
          <motion.div
            key={room.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onJoinRoom(room)}
            className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:border-purple-500/50 cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">{room.name}</h3>
                <div className="flex items-center gap-4 mt-2 text-sm text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {room.players.length}/{room.maxPlayers}
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-4 h-4" />
                    Buy-in: ${room.minBuyIn} - ${room.maxBuyIn}
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    BB: ${room.bigBlind}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Player Avatars */}
                <div className="flex -space-x-2">
                  {room.players.slice(0, 3).map((player, i) => (
                    <img
                      key={i}
                      src={player.avatar}
                      alt={player.username}
                      className="w-8 h-8 rounded-full border-2 border-zinc-900"
                    />
                  ))}
                  {room.players.length > 3 && (
                    <div className="w-8 h-8 rounded-full bg-zinc-700 border-2 border-zinc-900 flex items-center justify-center text-xs">
                      +{room.players.length - 3}
                    </div>
                  )}
                </div>

                <ChevronRight className="w-5 h-5 text-zinc-500" />
              </div>
            </div>

            {/* Room Status */}
            <div className="mt-3 flex items-center gap-2">
              {room.phase === 'waiting' ? (
                <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
                  Esperando jugadores
                </span>
              ) : (
                <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                  En juego
                </span>
              )}
              <span className="px-2 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-full">
                SB: ${room.smallBlind}
              </span>
            </div>
          </motion.div>
        ))}

        {filteredRooms.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No se encontraron salas</p>
          </div>
        )}
      </div>

      {/* Recent Hands */}
      {handHistory.length > 0 && (
        <div className="px-4 mt-6">
          <h2 className="font-semibold text-lg mb-3">Manos recientes</h2>
          <div className="space-y-2">
            {handHistory.slice(0, 5).map((hand) => (
              <div key={hand.id} className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{hand.roomName}</p>
                    <p className="text-xs text-zinc-400">
                      {new Date(hand.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-green-400 text-sm">${hand.pot}</p>

                  </div>
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Ganador: {hand.winner}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How to Play */}
      <div className="mx-4 mt-6 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
        <h3 className="font-semibold mb-3">¿Cómo jugar?</h3>
        <div className="space-y-2 text-sm text-zinc-400">
          <p>1. Selecciona una mesa según tu presupuesto</p>
          <p>2. Compra fichas (buy-in mínimo requerido)</p>
          <p>3. Espera a que inicie la mano o únete en curso</p>
          <p>4. Usa las acciones: Pasar, Igualar, Subir o Retirarse</p>
          <p className="text-yellow-400">💡 Gana mientras los jugadores se divierten</p>
        </div>
      </div>
    </div>
  );
};
