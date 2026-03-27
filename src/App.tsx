import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/hooks/useSecurity';
import { VideoFeed } from '@/components/VideoFeed';
import { ChatView } from '@/components/ChatView';
import { ProfileView } from '@/components/ProfileView';
import { DiscoverView } from '@/components/DiscoverView';
import { CameraView } from '@/components/CameraView';
import { PokerView } from '@/components/poker/PokerView';
import { CreateView } from '@/components/CreateView';
import { AuthView } from '@/components/AuthView';
import { AdminPanel } from '@/components/AdminPanel';
import { PaymentView } from '@/components/PaymentView';
import { BottomNav } from '@/components/BottomNav';
import { TopHeader } from '@/components/TopHeader';
import { DesktopSidebar } from '@/components/DesktopSidebar';
import { LandingPage } from '@/components/LandingPage';
import { SecurityOverlay } from '@/components/SecurityOverlay';
import { NotFoundView } from '@/components/NotFoundView';
import { BannersIncentivesView } from '@/components/BannersIncentivesView';
import { WhaTakaView } from '@/components/WhaTakaView';
import { WhaTakaLanding } from '@/components/WhaTakaLanding';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';

function App() {
  const { currentTab, setCurrentTab, currentUser, miningCycle } = useStore();
  const [showCamera, setShowCamera] = useState(false);
  const [showLanding, setShowLanding] = useState(() => !sessionStorage.getItem('taktak_visited'));
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Mining Cycle Effect (Simulated P2P rewards every 30s)
  useEffect(() => {
    if (currentUser) {
      const interval = setInterval(() => {
        const randomMined = Math.floor(Math.random() * 500) + 100;
        miningCycle(randomMined);
        console.log(`[TakTak Mining] Ciclo completado: ${randomMined} TTC generados`);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [currentUser, miningCycle]);

  useEffect(() => {
    interface TakTakWindow extends Window {
      showAdminPanel?: (show: boolean) => void;
    }
    const win = window as unknown as TakTakWindow;
    win.showAdminPanel = (show: boolean) => setShowAdminPanel(show);
    return () => {
      delete win.showAdminPanel;
    };
  }, []);

  // Initialize security system
  useSecurity();

  useEffect(() => {
    // Show security toast
    toast.success('🔒 Sistema de seguridad activado', {
      description: 'Encriptación AES-256 activa',
      duration: 3000
    });
  }, []);

  const handleEnterApp = () => {
    sessionStorage.setItem('taktak_visited', 'true');
    setShowLanding(false);
    toast.success('¡Bienvenido a TakTak!', {
      description: 'Tu experiencia descentralizada comienza ahora'
    });
  };

  const renderContent = () => {
    switch (currentTab) {
      case 'home':
        return <VideoFeed />;
      case 'following':
        return <VideoFeed filter="following" />;
      case 'live':
        return <VideoFeed filter="live" />;
      case 'discover':
        return <DiscoverView />;
      case 'poker':
        return <PokerView />;
      case 'create':
        return <CreateView />;
      case 'wallet':
        return <PaymentView />;
      case 'chat':
        return <ChatView />;
      case 'whataka':
        return <WhaTakaView />;
      case 'whataka-download':
        return <WhaTakaLanding />;
      case 'profile':
        return <ProfileView />;
      case 'incentives':
        return <BannersIncentivesView />;
      case 'policies':
        return <LandingPage onEnterApp={() => setCurrentTab('home')} />;
      default:
        return <NotFoundView onGoHome={() => setCurrentTab('home')} />;
    }
  };

  // Show landing page
  if (showLanding) {
    return (
      <>
        <LandingPage onEnterApp={handleEnterApp} />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid #27272a',
            },
          }}
        />
      </>
    );
  }

  // Show auth screen if not logged in
  if (!currentUser) {
    return (
      <>
        <AuthView />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid #27272a',
            },
          }}
        />
      </>
    );
  }

  // Show admin panel
  if (showAdminPanel && currentUser?.isOwner) {
    return (
      <>
        <AdminPanel onClose={() => setShowAdminPanel(false)} />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid #27272a',
            },
          }}
        />
      </>
    );
  }

  return (
    <div id="app" className="bg-black text-white min-h-screen">
      {/* Security Overlay */}
      <SecurityOverlay />

      {/* Desktop Header */}
      <TopHeader />

      <div className="flex pt-0 md:pt-16">
        {/* Desktop Sidebar */}
        <DesktopSidebar />

        {/* Main Content */}
        <main className="flex-1 pb-16 md:pb-0 md:ml-20 lg:ml-64 transition-all">
          <div className="max-w-[1200px] mx-auto min-h-full">
            {renderContent()}
          </div>
        </main>
      </div>

      {/* Bottom Navigation (Mobile Only) */}
      <div className="md:hidden">
        <BottomNav />
      </div>

      {/* Camera Modal */}
      <AnimatePresence>
        {showCamera && (
          <CameraView onClose={() => setShowCamera(false)} />
        )}
      </AnimatePresence>

      {/* Toast Notifications */}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#fff',
            border: '1px solid #27272a',
          },
        }}
      />

      {/* Branding (Mobile Only) */}
      <div className="md:hidden">
        {(currentTab === 'home' || currentTab === 'poker') && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 text-center">
            <div className="flex flex-col items-center">
              <h1 className="text-2xl font-black tracking-tighter text-white">
                Tak<span className="text-[#FE2C55]">Tak</span>{currentTab === 'poker' && ' Poker'}
              </h1>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] bg-[#FE2C55]/20 text-[#FE2C55] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  Descentralizado
                </span>
                <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 rounded-full">
                  <Lock className="w-2.5 h-2.5 text-green-400" />
                  <span className="text-[10px] text-green-400 font-bold uppercase">P2P</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
