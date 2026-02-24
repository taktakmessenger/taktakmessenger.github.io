import { motion } from 'framer-motion';
import { Home, Compass, MessageCircle, User, Diamond, Plus, Wallet } from 'lucide-react';
import { useStore } from '@/store/useStore';

export const BottomNav = () => {
  const { currentTab, setCurrentTab } = useStore();

  const tabs = [
    { id: 'home' as const, icon: Home, label: 'Inicio' },
    { id: 'discover' as const, icon: Compass, label: 'Descubrir' },
    { id: 'poker' as const, icon: Diamond, label: 'Poker' },
    { id: 'create' as const, icon: Plus, label: 'Crear', isCreate: true },
    { id: 'wallet' as const, icon: Wallet, label: 'Billetera' },
    { id: 'chat' as const, icon: MessageCircle, label: 'Chat' },
    { id: 'profile' as const, icon: User, label: 'Perfil' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800 z-40">
      <div className="flex items-center justify-around py-2">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          const Icon = tab.icon;

          if (tab.isCreate) {
            return (
              <motion.button
                key={tab.id}
                whileTap={{ scale: 0.9 }}
                onClick={() => setCurrentTab(tab.id)}
                className="flex flex-col items-center gap-1 py-2 px-4 relative"
              >
                <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs text-zinc-500">{tab.label}</span>
              </motion.button>
            );
          }

          return (
            <motion.button
              key={tab.id}
              whileTap={{ scale: 0.9 }}
              onClick={() => setCurrentTab(tab.id)}
              className="flex flex-col items-center gap-1 py-2 px-4 relative"
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute -top-1 w-8 h-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                />
              )}
              <Icon
                className={`w-6 h-6 transition-colors ${
                  isActive ? 'text-purple-400' : 'text-zinc-400'
                }`}
              />
              <span
                className={`text-xs transition-colors ${
                  isActive ? 'text-purple-400 font-medium' : 'text-zinc-500'
                }`}
              >
                {tab.label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
