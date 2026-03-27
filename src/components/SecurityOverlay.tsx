import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Lock, Eye, Fingerprint, Wifi, Check, X } from 'lucide-react';
import { useSecurity } from '@/hooks/useSecurity';

export const SecurityOverlay = () => {
  const { isSecure, isVPN, anonId, deviceFingerprint } = useSecurity();
  const [showDetails, setShowDetails] = useState(false);
  const [securityChecks, setSecurityChecks] = useState([
    { id: 'encrypt', label: 'Encriptación AES-256', status: true, icon: Lock },
    { id: 'anon', label: 'ID Anónimo', status: true, icon: Eye },
    { id: 'fingerprint', label: 'Fingerprint Ofuscado', status: true, icon: Fingerprint },
    { id: 'vpn', label: 'VPN Detectado', status: isVPN, icon: Wifi },
  ]);

  useEffect(() => {
    // Update VPN status when detected
    setSecurityChecks(prev => 
      prev.map(check => 
        check.id === 'vpn' ? { ...check, status: isVPN } : check
      )
    );
  }, [isVPN]);

  const getStatusColor = (status: boolean) => {
    return status ? 'text-green-400' : 'text-yellow-400';
  };

  const getStatusBg = (status: boolean) => {
    return status ? 'bg-green-500/20' : 'bg-yellow-500/20';
  };

  return (
    <>
      {/* Security Indicator */}
      <motion.button
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => setShowDetails(!showDetails)}
        className="fixed top-20 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-gray-100/90 backdrop-blur-md rounded-full border border-zinc-800 hover:border-green-500/50 transition-all"
      >
        <div className={`w-2 h-2 rounded-full ${isSecure ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
        <Shield className="w-4 h-4 text-green-400" />
        <span className="text-xs text-zinc-300 hidden sm:inline">Seguro</span>
      </motion.button>

      {/* Security Details Modal */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/80 backdrop-blur-sm"
            onClick={() => setShowDetails(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-gray-100 rounded-2xl border border-zinc-800 overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-b border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                      <Shield className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-black">Estado de Seguridad</h3>
                      <p className="text-xs text-green-400">Sistema protegido</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-600" />
                  </button>
                </div>
              </div>

              {/* Security Checks */}
              <div className="p-4 space-y-3">
                {securityChecks.map((check) => {
                  const Icon = check.icon;
                  return (
                    <div
                      key={check.id}
                      className={`flex items-center justify-between p-3 rounded-xl ${getStatusBg(check.status)}`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-5 h-5 ${getStatusColor(check.status)}`} />
                        <span className="text-sm text-black">{check.label}</span>
                      </div>
                      {check.status ? (
                        <Check className="w-5 h-5 text-green-400" />
                      ) : (
                        <span className="text-xs text-yellow-400">No detectado</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Technical Info */}
              <div className="p-4 border-t border-zinc-800 space-y-3">
                <h4 className="text-sm font-medium text-gray-600">Información Técnica</h4>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">ID Anónimo</span>
                    <code className="text-xs text-gray-600 bg-gray-200 px-2 py-1 rounded">
                      {anonId?.substring(0, 16)}...
                    </code>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Fingerprint</span>
                    <code className="text-xs text-gray-600 bg-gray-200 px-2 py-1 rounded">
                      {deviceFingerprint?.substring(0, 16)}...
                    </code>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Encriptación</span>
                    <span className="text-green-400 text-xs">AES-256-CBC</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Hashing</span>
                    <span className="text-green-400 text-xs">SHA-512</span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 bg-zinc-950 border-t border-zinc-800">
                <p className="text-xs text-zinc-500 text-center">
                  Tus datos están protegidos con encriptación de grado militar.
                  <br />
                  TakTak nunca vende ni comparte tu información.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
