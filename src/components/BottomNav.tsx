import { useStore } from '@/store/useStore';
import { Home, Compass, PlusSquare, Wallet, User, Settings } from 'lucide-react';

const WTIcon = ({ active }: { active: boolean }) => (
  <div className={`w-7 h-7 flex items-center justify-center rounded-full font-black text-[10px] border-2 transition-all shadow-lg ${
    active 
      ? 'bg-gradient-to-br from-purple-600 to-black text-white border-yellow-500 scale-110' 
      : 'bg-black text-purple-400 border-purple-900'
  }`}>
    WT
  </div>
);

export const BottomNav = () => {
  const { currentTab, setCurrentTab } = useStore();

  const navItems = [
    { id: 'home' as const, icon: Home, label: 'Inicio' },
    { id: 'discover' as const, icon: Compass, label: 'Descubrir' },
    { id: 'create' as const, icon: PlusSquare, special: true },
    { id: 'wallet' as const, icon: Wallet, label: 'Wallet' },
    { id: 'whataka' as const, icon: null, label: 'WhaTaka', isWT: true },
    { id: 'profile' as const, icon: User, label: 'Perfil' },
    { id: 'policies' as const, icon: Settings, label: 'Políticas' },
  ];

  return (
    <nav className="fixed bottom-0 w-full bg-black border-t border-purple-900/30 pb-safe z-50">
      <div className="flex justify-around items-center h-16 px-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentTab(item.id)}
            className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
              currentTab === item.id ? 'text-purple-400' : 'text-zinc-600 hover:text-purple-500/70'
            }`}
            aria-label={item.label || 'Crear'}
            title={item.label || 'Crear'}
          >
            {item.special ? (
              <div className="relative group">
                {/* Removed TikTok Red/Cyan offsets */}
                <div className={`relative px-3 py-1.5 rounded-xl flex items-center justify-center shadow-lg transition-all ${
                  currentTab === item.id 
                    ? 'bg-gradient-to-br from-purple-600 to-purple-800 border border-yellow-500 scale-110' 
                    : 'bg-zinc-900 border border-purple-900'
                }`}>
                  {item.icon && <item.icon className={`w-5 h-5 font-bold ${currentTab === item.id ? 'text-white' : 'text-purple-500'}`} />}
                </div>
              </div>
            ) : (
              <>
                <div className="mb-0.5">
                  {item.isWT ? (
                    <WTIcon active={currentTab === 'whataka'} />
                  ) : (
                    item.icon && <item.icon className={`w-6 h-6 transition-colors ${currentTab === item.id ? 'text-purple-400' : 'text-zinc-600'}`} />
                  )}
                </div>
                {item.label && (
                  <span className={`text-[9px] hidden sm:block font-bold truncate w-full text-center px-1 uppercase tracking-tighter ${
                    currentTab === item.id ? 'text-purple-400' : 'text-zinc-600'
                  }`}>
                    {item.label}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};
