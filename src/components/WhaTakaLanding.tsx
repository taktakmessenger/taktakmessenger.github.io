import { motion } from 'framer-motion';
import { Download, Shield, MessageCircle, Zap, Lock, Globe, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';

const WTLogo = () => (
  <div className="w-24 h-24 bg-gradient-to-br from-purple-600 via-purple-800 to-black border-4 border-yellow-500 rounded-3xl flex items-center justify-center font-black text-white text-3xl shadow-[0_0_40px_rgba(168,85,247,0.5)]">
    WT
  </div>
);

export const WhaTakaLanding = () => {
  const { setCurrentTab } = useStore();

  const features = [
    { icon: Lock, title: 'Encriptado E2E', desc: 'Tus mensajes son 100% privados' },
    { icon: Shield, title: 'Sin Rastreo', desc: 'Cero recolección de datos' },
    { icon: Zap, title: 'Ultra Rápido', desc: 'Mensajes instantáneos P2P' },
    { icon: Globe, title: 'Descentralizado', desc: 'Sin servidores centrales' },
  ];

  return (
    <div className="min-h-screen bg-black overflow-y-auto pb-20">
      {/* Hero */}
      <div className="relative overflow-hidden">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/40 via-black to-black" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-3xl" />
        
        <div className="relative z-10 px-6 pt-10 pb-16 flex flex-col items-center text-center">
          {/* Back Button */}
          <button 
            onClick={() => setCurrentTab('discover')} 
            className="self-start mb-8 text-purple-400 hover:text-white flex items-center gap-2 text-sm font-bold"
          >
            <ArrowLeft className="w-4 h-4" /> Volver a TakTak
          </button>

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            <WTLogo />
          </motion.div>

          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-5xl font-black mt-8 mb-3"
          >
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-yellow-500 to-purple-400">
              WhaTaka
            </span>
          </motion.h1>

          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-zinc-400 text-lg max-w-xs font-medium"
          >
            Mensajería P2P descentralizada. Privada. Segura. Tuya.
          </motion.p>

          {/* Download Button */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-10 w-full max-w-xs"
          >
            <Button 
              className="w-full h-16 bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 text-white font-black text-lg rounded-2xl border border-yellow-500/30 shadow-[0_0_30px_rgba(168,85,247,0.3)] transition-all hover:scale-105"
              onClick={() => {
                const link = document.createElement('a');
                link.href = '/api/downloads/whataka.html';
                link.download = 'whataka.html';
                link.click();
              }}
            >
              <Download className="w-6 h-6 mr-3" />
              Descargar WhaTaka
            </Button>
            <p className="text-zinc-600 text-[10px] mt-3 uppercase tracking-widest font-bold">
              PWA · Sin App Store · 100% Gratis
            </p>
          </motion.div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="px-6 py-8">
        <h2 className="text-yellow-500 text-xs font-black uppercase tracking-[0.3em] mb-6 text-center">
          ¿Por qué WhaTaka?
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {features.map((feature, i) => (
            <motion.div
              key={i}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="bg-gradient-to-br from-zinc-900 to-black border border-purple-900/30 rounded-2xl p-5 text-center hover:border-purple-500/30 transition-colors"
            >
              <feature.icon className="w-8 h-8 text-purple-400 mx-auto mb-3" />
              <h3 className="text-white font-bold text-sm mb-1">{feature.title}</h3>
              <p className="text-zinc-500 text-[11px]">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* How to Install */}
      <div className="px-6 py-8">
        <h2 className="text-yellow-500 text-xs font-black uppercase tracking-[0.3em] mb-6 text-center">
          Instalación en 3 pasos
        </h2>
        <div className="space-y-4">
          {[
            { step: '1', title: 'Descarga', desc: 'Toca el botón "Descargar WhaTaka"' },
            { step: '2', title: 'Abre', desc: 'Abre whataka.html en Chrome o Safari' },
            { step: '3', title: 'Instala', desc: '"Añadir a pantalla de inicio" y listo' },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.15 }}
              className="flex items-center gap-4 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-black border-2 border-yellow-500 flex items-center justify-center font-black text-white text-sm shrink-0">
                {item.step}
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">{item.title}</h3>
                <p className="text-zinc-500 text-xs">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Mining Info (Hidden/Subtle) */}
      <div className="px-6 py-8">
        <div className="bg-gradient-to-br from-purple-950/50 to-black border border-purple-900/30 rounded-2xl p-6 text-center">
          <MessageCircle className="w-10 h-10 text-yellow-500 mx-auto mb-4" />
          <h3 className="text-white font-black text-lg mb-2">Chatea. Es todo.</h3>
          <p className="text-zinc-500 text-sm max-w-xs mx-auto">
            WhaTaka funciona dentro de TakTak y también como app independiente. Tu privacidad es lo primero.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-6 h-6 bg-gradient-to-br from-purple-600 to-black border border-yellow-500 rounded-full flex items-center justify-center font-black text-white text-[7px]">
            WT
          </div>
          <span className="text-zinc-600 text-xs font-bold">WhaTaka by TakTak</span>
        </div>
        <p className="text-zinc-700 text-[10px]">© 2026 TakTak · Descentralizado · P2P</p>
      </div>
    </div>
  );
};
