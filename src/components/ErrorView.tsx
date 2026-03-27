import { motion } from 'framer-motion';
import { AlertCircle, RefreshCw } from 'lucide-react';

export const ErrorView = ({ error, onRetry }: { error: Error, onRetry: () => void }) => {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white p-6 text-center">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
        <h1 className="text-3xl font-black mb-4 text-red-500">Error Crítico</h1>
        <p className="text-zinc-400 mb-2 max-w-md">
          Ocurrió un problema inesperado en la red P2P o en la aplicación.
        </p>
        <div className="bg-black/50 p-4 rounded-xl border border-red-500/20 mb-8 max-w-lg text-left overflow-hidden">
          <code className="text-xs text-red-400 whitespace-pre-wrap break-words font-mono">
            {error.message || 'Error Desconocido'}
          </code>
        </div>
        <button 
          onClick={onRetry}
          className="flex items-center justify-center gap-2 mx-auto w-full max-w-xs bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl font-bold transition-all"
        >
          <RefreshCw className="w-5 h-5" />
          Reintentar
        </button>
      </motion.div>
    </div>
  );
};
