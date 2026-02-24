import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PokerLobby } from './PokerLobby';
import { PokerGame } from './PokerGame';
import { usePokerStore } from '@/store/pokerStore';
import type { PokerRoom } from '@/utils/pokerLogic';

export const PokerView = () => {
  const [inGame, setInGame] = useState(false);
  const { setCurrentRoom } = usePokerStore();

  const handleJoinRoom = (room: PokerRoom) => {
    setCurrentRoom(room);
    setInGame(true);
  };

  const handleBackToLobby = () => {
    setInGame(false);
    setCurrentRoom(null);
  };

  return (
    <AnimatePresence mode="wait">
      {inGame ? (
        <motion.div
          key="game"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-screen"
        >
          <PokerGame onBack={handleBackToLobby} />
        </motion.div>
      ) : (
        <motion.div
          key="lobby"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-screen"
        >
          <PokerLobby onJoinRoom={handleJoinRoom} />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
