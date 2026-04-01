import React, { useState, useEffect, createContext, useContext } from 'react';
import axios from 'axios';
import Feed from './components/Feed';
import Upload from './components/Upload';

/**
 * TakTak App - Real Implementation
 * - Auth Context for JWT
 * - Simple UI with Feed and Upload
 * - Real API integration (presigned URLs, Feed)
 */

// Global Axios Config
axios.defaults.baseURL = ''; 

interface User {
  sub: string;
  name?: string;
  email?: string;
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  setAuth: () => {},
  logout: () => {},
});

/* ----- Auth Logic Hook ----- */
function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('taktak_token'));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('taktak_user');
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  });

  useEffect(() => {
    if (token) {
      localStorage.setItem('taktak_token', token);
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      localStorage.removeItem('taktak_token');
      delete axios.defaults.headers.common.Authorization;
    }
  }, [token]);

  const setAuthData = (newToken: string, userObj: User) => {
    setToken(newToken);
    setUser(userObj);
    localStorage.setItem('taktak_user', JSON.stringify(userObj));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('taktak_user');
  };

  return { token, user, setAuthData, logout };
}

/* ----- Simple Login component ----- */
function Login() {
  const { setAuth } = useContext(AuthContext);
  const [loading, setLoading] = useState(false);

  // Demo Login (Can be expanded with real credentials)
  async function handleDemoLogin() {
    setLoading(true);
    try {
      // For the REAL version, this would be an actual API call to /api/auth/login
      // For now, let's mock it with a dummy token as provided in the instructions
      setTimeout(() => {
        setAuth('demo-token', { 
            sub: '65f8a...-user-uuid', 
            name: 'El Malayaso Admin',
            email: 'eliecerdepablos@gmail.com'
        });
        setLoading(false);
      }, 500);
    } catch (err) {
      console.error(err);
      setLoading(false);
      alert('Login fallido');
    }
  }

  return (
    <button 
      onClick={handleDemoLogin} 
      disabled={loading}
      className="px-4 py-2 bg-white text-black rounded-lg font-bold hover:shadow-[0_0_15px_rgba(255,255,255,0.4)] transition-all"
    >
      {loading ? 'Entrando...' : 'Entrar (Demo)'}
    </button>
  );
}

/* ----- Main App Content ----- */
export default function App() {
  const auth = useAuth();
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

  return (
    <AuthContext.Provider value={{
      token: auth.token,
      user: auth.user,
      setAuth: auth.setAuthData,
      logout: auth.logout,
    }}>
      <div className="min-h-screen bg-black text-white selection:bg-[#FE2C55]">
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-md px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-black italic tracking-tighter text-[#FE2C55]">
                Tak<span className="text-white">Tak</span>
              </h1>
              {!isOnline && (
                <span className="text-xs bg-red-600 px-2 py-1 rounded-full animate-pulse">OFFLINE</span>
              )}
            </div>

            <nav className="flex items-center gap-6">
              {auth.user ? (
                <>
                  <div className="text-sm font-medium hidden sm:block">
                    {auth.user.name} <span className="opacity-40 italic">({auth.user.email})</span>
                  </div>
                  <Upload />
                  <button 
                    onClick={auth.logout}
                    className="text-sm opacity-60 hover:opacity-100 transition-opacity"
                  >
                    Cerrar sesión
                  </button>
                </>
              ) : (
                <Login />
              )}
            </nav>
          </div>
        </header>

        <main className="pt-24 pb-12 px-4 max-w-lg mx-auto">
          <Feed />
        </main>

        <footer className="max-w-lg mx-auto px-4 py-12 border-t border-white/10 text-center opacity-30 text-sm">
          <p>© 2026 TakTak - La Evolución del Vídeo P2P</p>
        </footer>
      </div>
    </AuthContext.Provider>
  );
}
