import { motion } from 'framer-motion';
import { Home, AlertTriangle } from 'lucide-react';

export const NotFoundView = ({ onGoHome }: { onGoHome: () => void }) => {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white p-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring' }}
      >
        <AlertTriangle className="w-24 h-24 text-yellow-500 mx-auto mb-6" />
        <h1 className="text-6xl font-black mb-4">404</h1>
        <h2 className="text-2xl font-bold mb-2">Página no encontrada</h2>
        <p className="text-zinc-400 mb-8 max-w-md">
          Parece que hemos perdido la conexión con este bloque. El contenido que buscas no existe o ha sido movido.
        </p>
        <button 
          onClick={onGoHome}
          className="flex items-center gap-2 mx-auto bg-yellow-600 hover:bg-yellow-500 text-black px-6 py-3 rounded-xl font-bold transition-all"
        >
          <Home className="w-5 h-5" />
          Volver al Inicio
        </button>
      </motion.div>
    </div>
  );
};
