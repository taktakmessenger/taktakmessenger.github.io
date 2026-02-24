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
import { LandingPage } from '@/components/LandingPage';
import { SecurityOverlay } from '@/components/SecurityOverlay';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';

function App() {
  const { currentTab, currentUser } = useStore();
  const [showCamera, setShowCamera] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [securityInitialized, setSecurityInitialized] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  useEffect(() => {
    (window as any).showAdminPanel = (show: boolean) => setShowAdminPanel(show);
    return () => {
      delete (window as any).showAdminPanel;
    };
  }, []);

  // Initialize security system
  useSecurity();

  useEffect(() => {
    // Check if user has visited before
    const hasVisited = sessionStorage.getItem('taktak_visited');
    if (hasVisited) {
      setShowLanding(false);
    }

    // Mark security as initialized
    setSecurityInitialized(true);

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
      description: 'Tu experiencia segura comienza ahora'
    });
  };

  const renderContent = () => {
    switch (currentTab) {
      case 'home':
        return <VideoFeed />;
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
      case 'profile':
        return <ProfileView />;
      default:
        return <VideoFeed />;
    }
  };

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
    <div className="min-h-screen bg-black">
      {/* Security Overlay */}
      {securityInitialized && <SecurityOverlay />}

      {/* Main Content */}
      <main className="pb-16">
        {renderContent()}
      </main>

      {/* Bottom Navigation */}
      <BottomNav />

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

      {/* Branding */}
      {(currentTab === 'home' || currentTab === 'poker') && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold gradient-text">
              {currentTab === 'poker' ? 'TakTak Poker' : 'TakTak'}
            </h1>
            <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
              Beta
            </span>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 rounded-full">
              <Lock className="w-3 h-3 text-green-400" />
              <span className="text-xs text-green-400">Seguro</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
