import { useState } from 'react';
import { Search, PlusSquare, MessageSquare, Bell, Hash, Wallet } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const TopHeader = () => {
  const { setCurrentTab, currentUser } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);

  // Mock results for the dropdown
  const searchResults = [
    { type: 'user', username: 'creador_pro', name: 'Creador Pro', avatar: 'https://picsum.photos/200?random=1' },
    { type: 'hashtag', name: 'viral', views: '2.5B' },
    { type: 'user', username: 'influencer_tiktok', name: 'Influencer', avatar: 'https://picsum.photos/200?random=2' },
    { type: 'hashtag', name: 'tendencia', views: '800M' },
  ].filter(r => 
    r.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleResultClick = () => {
    setShowResults(false);
    setSearchQuery('');
    setCurrentTab('discover'); // Or a specific search results page
  };

  return (
    <header className="hidden md:flex fixed top-0 left-0 right-0 h-16 bg-black border-b border-zinc-800 items-center justify-between px-6 z-50">
      {/* Logo */}
      <div 
        className="flex items-center gap-2 cursor-pointer" 
        onClick={() => setCurrentTab('home')}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-black font-black">T</div>
        <span className="text-2xl font-black text-white hidden lg:block">TakTak</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md mx-8 relative">
        <Input 
          className="w-full bg-zinc-900 border-none rounded-full py-2 pl-4 pr-12 text-white"
          placeholder="Buscar cuentas y videos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
        />
        <div className="absolute right-0 top-0 h-full w-12 flex items-center justify-center border-l border-zinc-800 rounded-r-full hover:bg-zinc-800 cursor-pointer text-zinc-400">
          <Search className="w-5 h-5" />
        </div>

        {/* Dropdown Results */}
        {showResults && searchQuery.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
            {searchResults.length > 0 ? (
              <div className="max-h-96 overflow-y-auto python pb-2">
                {searchResults.map((result, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 cursor-pointer transition-colors"
                    onClick={handleResultClick}
                  >
                    {result.type === 'user' ? (
                      <>
                        <img src={result.avatar} alt={result.username} className="w-10 h-10 rounded-full object-cover" />
                        <div>
                          <p className="text-white font-medium text-sm">@{result.username}</p>
                          <p className="text-zinc-500 text-xs">{result.name}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                          <Hash className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">#{result.name}</p>
                          <p className="text-zinc-500 text-xs">{result.views} visualizaciones</p>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-zinc-500 text-sm">
                No se encontraron resultados para "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <Button 
          variant="outline" 
          className="hidden lg:flex border-zinc-700 text-white hover:bg-zinc-800 hover:text-white gap-2"
          onClick={() => setCurrentTab('create')}
        >
          <PlusSquare className="w-4 h-4" />
          Crear
        </Button>
        <button 
          className="p-2 text-zinc-400 hover:text-white transition-colors"
          onClick={() => setCurrentTab('chat')}
          aria-label="Mensajes"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
        <button 
          className="p-2 text-zinc-400 hover:text-white transition-colors"
          aria-label="Notificaciones"
        >
          <Bell className="w-6 h-6" />
        </button>
        <button 
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 transition-all group"
          onClick={() => setCurrentTab('wallet')}
          aria-label="Billetera"
          title="Ver Billetera"
        >
          <Wallet className="w-4 h-4 text-[#FE2C55] group-hover:scale-110 transition-transform" />
          <span className="text-white font-bold text-sm tracking-tight">
            TTC {(useStore.getState().ttcC + useStore.getState().ttcR).toLocaleString()}
          </span>
        </button>
        <div 
          className="w-8 h-8 rounded-full overflow-hidden cursor-pointer border border-zinc-800"
          onClick={() => setCurrentTab('profile')}
        >
          <img src={currentUser?.avatar || 'https://picsum.photos/200'} alt="Profile" className="w-full h-full object-cover" />
        </div>
      </div>
    </header>
  );
};
