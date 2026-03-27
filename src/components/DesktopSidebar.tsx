import { Home, Compass, Users, PlusSquare, User, Settings, Wallet } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';

export const DesktopSidebar = () => {
  const { currentTab, setCurrentTab } = useStore();

  const menuItems = [
    { id: 'home' as const, icon: Home, label: 'Para ti', active: currentTab === 'home' },
    { id: 'following' as const, icon: Users, label: 'Siguiendo', active: currentTab === 'following' },
    { id: 'discover' as const, icon: Compass, label: 'Explorar', active: currentTab === 'discover' },
    { id: 'create' as const, icon: PlusSquare, label: 'Crear', active: currentTab === 'create' },
    { id: 'wallet' as const, icon: Wallet, label: 'Billetera', active: currentTab === 'wallet' },
    { id: 'profile' as const, icon: User, label: 'Perfil', active: currentTab === 'profile' },
    { id: 'policies' as const, icon: Settings, label: 'Políticas', active: currentTab === 'policies' },
  ];

  return (
    <aside className="hidden md:flex flex-col w-20 lg:w-64 fixed left-0 top-16 bottom-0 bg-black border-r border-zinc-800 p-4 transition-all z-40 overflow-y-auto">
      <nav className="flex-1 space-y-2">
        {menuItems.map((item) => (
          <div
            key={item.id}
            onClick={() => setCurrentTab(item.id)}
            className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors ${
              item.active 
                ? 'bg-purple-500/10 text-purple-400' 
                : 'text-white hover:bg-zinc-800'
            }`}
          >
            <item.icon className="w-7 h-7" />
            <span className={`text-lg font-bold hidden lg:block ${item.active ? 'text-purple-400' : ''}`}>
              {item.label}
            </span>
          </div>
        ))}
      </nav>

      {/* Suggested Accounts (Desktop Only) */}
      <div className="hidden lg:block mt-8 pt-8 border-t border-zinc-800">
        <p className="text-zinc-500 text-sm font-semibold mb-4 px-3 uppercase tracking-wider">Cuentas sugeridas</p>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 hover:bg-zinc-800 rounded-xl cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden">
              <img src={`https://picsum.photos/200?sig=${i}`} alt="" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold truncate">usuario_pro_{i}</p>
              <p className="text-zinc-500 text-xs truncate">Creador de contenido</p>
            </div>
          </div>
        ))}
        <Button variant="link" className="text-purple-400 p-3 h-auto">Ver todo</Button>
      </div>

      {/* Footer Links (Desktop Only) */}
      <div className="hidden lg:block mt-auto pt-8">
        <div className="flex items-center gap-3 p-3 hover:bg-zinc-800 rounded-xl cursor-pointer text-zinc-500 hover:text-white transition-colors">
          <Settings className="w-5 h-5" />
          <span className="text-sm font-medium">Configuración</span>
        </div>
        <div className="p-3 text-xs text-zinc-500">
          <div className="flex flex-wrap gap-2 mb-4">
            <span>Información</span>
            <span>Sala de prensa</span>
            <span>Contacto</span>
            <span>Vacantes</span>
            <span>ByteDance</span>
          </div>
          <p>© 2026 TakTak</p>
        </div>
      </div>
    </aside>
  );
};
