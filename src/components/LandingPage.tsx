import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Smartphone, Download } from 'lucide-react';

interface LandingPageProps {
  onEnterApp: () => void;
}

export const LandingPage = ({ onEnterApp }: LandingPageProps) => {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Show buttons after a small delay (splash effect)
    const timer = setTimeout(() => {
      setShowContent(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleDownload = () => {
    // This will point to the server endpoint we'll create
    window.location.href = '/api/downloads/taktak.apk';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-6 overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-pink-600/20 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-md gap-8">
        {/* Logo Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center"
        >
          <motion.img
            src="/taktak-logo.jpeg"
            alt="TakTak"
            className="w-32 h-32 rounded-3xl shadow-2xl shadow-purple-500/30 border border-white/10"
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
          />
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 text-4xl font-black gradient-text tracking-tighter"
          >
            TakTak
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-2 text-zinc-400 font-medium"
          >
            Tu mundo en 15 segundos
          </motion.p>
        </motion.div>

        {/* Interaction Section */}
        <AnimatePresence>
          {showContent && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col w-full gap-4"
            >
              <button
                onClick={onEnterApp}
                className="group relative flex items-center justify-between w-full h-16 px-6 bg-white rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-white/5"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-black rounded-xl group-hover:bg-purple-600 transition-colors">
                    <Globe className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex flex-col items-start translate-y-[-1px]">
                    <span className="text-black font-bold text-lg leading-none">Continuar en Web</span>
                    <span className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mt-1">Sin instalación</span>
                  </div>
                </div>
                <div className="w-8 h-8 flex items-center justify-center rounded-full border border-zinc-200 group-hover:translate-x-1 transition-transform">
                  <span className="text-black font-bold">→</span>
                </div>
              </button>

              <button
                onClick={handleDownload}
                className="group relative flex items-center justify-between w-full h-16 px-6 bg-zinc-900 border border-zinc-800 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] hover:border-purple-500/50"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-zinc-800 rounded-xl group-hover:bg-purple-600/20 transition-colors">
                    <Smartphone className="w-6 h-6 text-white group-hover:text-purple-400" />
                  </div>
                  <div className="flex flex-col items-start translate-y-[-1px]">
                    <span className="text-white font-bold text-lg leading-none">Descargar App</span>
                    <span className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mt-1">Versión Android</span>
                  </div>
                </div>
                <div className="w-8 h-8 flex items-center justify-center rounded-full border border-zinc-700 group-hover:bg-purple-600 transition-colors">
                  <Download className="w-4 h-4 text-white" />
                </div>
              </button>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="mt-4 flex flex-col items-center gap-2"
              >
                <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Servidor Seguro E2E</span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Branding */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-10 text-zinc-600 text-[10px] font-bold uppercase tracking-[0.2em]"
      >
        © 2024 TakTak Entertainment
      </motion.div>
    </div>
  );
};
