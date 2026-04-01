import { useState, useEffect } from 'react';
import Feed from './components/Feed';
import Upload from './components/Upload';
import { LandingPage } from './components/LandingPage';
import { useStore } from './store/useStore';
import { LogOut } from 'lucide-react';
import { Toaster } from 'sonner';

/**
 * TakTak App - Real Implementation
 * - Uses Zustand Store for Auth/Global State
 * - Premium Landing Page for Auth Flow
 * - Feed and Upload for Authenticated Users
 */

export default function App() {
  const { currentUser, isAuthenticated, logout } = useStore();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Si no está autenticado, mostramos la "Pepa del Queso" (Landing Page Real)
  if (!isAuthenticated || !currentUser) {
    return (
      <>
        <LandingPage onEnterApp={() => {}} onAuth={() => {}} />
        <Toaster position="top-center" expand={true} richColors />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#FE2C55]">
      <Toaster position="top-center" expand={true} richColors />
      
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-black italic tracking-tighter text-[#FE2C55]">
              Tak<span className="text-white">Tak</span>
            </h1>
            {!isOnline && (
              <span className="text-xs bg-red-600 px-2 py-1 rounded-full animate-pulse tracking-widest font-bold">OFFLINE</span>
            )}
          </div>

          <nav className="flex items-center gap-6">
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hidden sm:flex">
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-yellow-500 to-yellow-200 flex items-center justify-center text-black font-bold text-[10px]">
                {currentUser.username[0].toUpperCase()}
              </div>
              <div className="text-xs font-bold truncate max-w-[100px]">
                @{currentUser.username}
              </div>
            </div>
            
            <Upload />
            
            <button 
              onClick={logout}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400 hover:text-white"
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </nav>
        </div>
      </header>

      <main className="pt-24 pb-12 px-4 max-w-lg mx-auto">
        <Feed />
      </main>

      <footer className="max-w-lg mx-auto px-4 py-12 border-t border-white/10 text-center opacity-30 text-[10px] uppercase font-bold tracking-widest">
        <p>© 2026 TakTak - La Pepa del Queso P2P</p>
      </footer>
    </div>
  );
}
