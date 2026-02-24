import { motion } from 'framer-motion';
import type { Card as CardType } from '@/utils/pokerLogic';
import { getSuitSymbol, getSuitColor } from '@/utils/pokerLogic';

interface CardProps {
  card?: CardType;
  hidden?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
}

const sizeClasses = {
  sm: 'w-10 h-14 text-sm',
  md: 'w-16 h-22 text-lg',
  lg: 'w-20 h-28 text-xl'
};

export const Card = ({ card, hidden = false, size = 'md', animate = true }: CardProps) => {
  if (hidden || !card) {
    return (
      <motion.div
        initial={animate ? { rotateY: 180 } : false}
        animate={{ rotateY: 0 }}
        transition={{ duration: 0.3 }}
        className={`
          ${sizeClasses[size]}
          bg-gradient-to-br from-blue-600 to-blue-800
          rounded-lg border-2 border-white/20
          flex items-center justify-center
          shadow-lg
        `}
      >
        <div className="w-3/4 h-3/4 border border-white/20 rounded" />
      </motion.div>
    );
  }

  const suitSymbol = getSuitSymbol(card.suit);
  const suitColor = getSuitColor(card.suit);

  return (
    <motion.div
      initial={animate ? { rotateY: 180, scale: 0.8 } : false}
      animate={{ rotateY: 0, scale: 1 }}
      transition={{ duration: 0.3, type: 'spring' }}
      whileHover={{ scale: 1.05, y: -5 }}
      className={`
        ${sizeClasses[size]}
        bg-white rounded-lg border-2 border-zinc-300
        flex flex-col items-center justify-center
        shadow-lg cursor-pointer
        select-none
      `}
    >
      <span className={`font-bold ${suitColor}`}>
        {card.rank}
      </span>
      <span className={`text-2xl ${suitColor}`}>
        {suitSymbol}
      </span>
    </motion.div>
  );
};

export const CardBack = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => (
  <div className={`
    ${sizeClasses[size]}
    bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800
    rounded-lg border-2 border-white/30
    flex items-center justify-center
    shadow-lg
  `}>
    <div className="w-3/4 h-3/4 border-2 border-white/20 rounded flex items-center justify-center">
      <div className="w-1/2 h-1/2 border border-white/10 rounded-full" />
    </div>
  </div>
);
