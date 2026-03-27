import { useState } from 'react';
import { ArrowLeft, Gift, AlertCircle, Copy, Download, Unlock, Lock, AlertTriangle } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export const BannersIncentivesView = () => {
  const { ttcR, currentUser, setCurrentTab, withdrawProgressive } = useStore();
  const [amount, setAmount] = useState('');

  if (!currentUser) return null;

  const currentLevel = currentUser.incentiveLevel || 1;
  const isWhale = currentUser.isWhale || false;
  
  const usdBalance = ttcR * 0.00001;

  const handleWithdraw = (targetUsd: number) => {
    const { success, message } = withdrawProgressive(targetUsd);
    if (success) {
      toast.success(message);
    } else {
      toast.error(message);
    }
  };

  const handleCustomWithdraw = () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast.error('Ingresa un monto válido');
      return;
    }
    handleWithdraw(val);
    setAmount('');
  };

  const levels = [
    { level: 1, target: 10, title: 'Nivel 1', desc: 'Retira exactamente $10 USD', fee: '0% Comisión' },
    { level: 2, target: 20, title: 'Nivel 2', desc: 'Retira exactamente $20 USD', fee: '0% Comisión' },
    { level: 3, target: 100, title: 'Nivel 3', desc: 'Retira exactamente $100 USD', fee: '0% Comisión' },
    { level: 4, target: null, title: 'Nivel 4 (Especial)', desc: 'Retira el monto que desees (1 vez)', fee: '3% Comisión' },
    { level: 5, target: null, title: 'Nivel 5 (Normal)', desc: 'Retiros ilimitados por minado', fee: '5% Comisión' },
  ];

  return (
    <div className="flex flex-col h-screen bg-black text-white overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-black/80 backdrop-blur-md p-4 border-b border-zinc-800 flex items-center gap-4 z-50">
        <button 
          onClick={() => setCurrentTab('profile')} 
          aria-label="Volver al Perfil"
          title="Volver al Perfil"
          className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Gift className="w-5 h-5 text-yellow-500" />
          Banners e Incentivos
        </h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Balance Status */}
        <div className="bg-gradient-to-r from-yellow-600 to-amber-500 rounded-3xl p-6 shadow-2xl relative overflow-hidden text-black">
          <p className="text-sm font-bold uppercase tracking-widest opacity-80 mb-1">Saldo de Incentivos</p>
          <p className="text-4xl font-black mb-1">${usdBalance.toFixed(2)} USD</p>
          <p className="text-sm font-mono opacity-80">{ttcR.toLocaleString()} TTC-R</p>
          
          {isWhale && (
            <div className="mt-4 p-3 bg-red-500/20 rounded-xl border border-red-500/50 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-900 mt-0.5" />
              <div>
                <p className="font-bold text-red-900 text-sm">Alerta de Seguridad</p>
                <p className="text-xs text-red-900/80">Tu cuenta está sujeta a comisiones del 10% por actividad inusual.</p>
              </div>
            </div>
          )}
        </div>

        {/* Withdrawal Tiers */}
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Unlock className="w-5 h-5 text-purple-400" />
            Niveles de Retiro
          </h2>
          <div className="space-y-3">
            {levels.map((lvl) => {
              const isActive = currentLevel === lvl.level;
              const isPast = currentLevel > lvl.level;
              const isLocked = currentLevel < lvl.level;
              
              const canAfford = lvl.target !== null ? usdBalance >= lvl.target : usdBalance > 0;

              return (
                <div 
                  key={lvl.level}
                  className={`p-4 rounded-2xl border ${
                    isActive 
                      ? 'bg-zinc-900 border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.15)]' 
                      : isPast 
                        ? 'bg-zinc-900/50 border-green-500/30' 
                        : 'bg-zinc-900/30 border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isPast ? <Unlock className="w-4 h-4 text-green-500" /> : isLocked ? <Lock className="w-4 h-4 text-zinc-600" /> : <Unlock className="w-4 h-4 text-yellow-500" />}
                      <span className={`font-bold ${isActive ? 'text-yellow-500' : isPast ? 'text-green-500' : 'text-zinc-500'}`}>
                        {lvl.title}
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${isWhale ? 'bg-red-500/20 text-red-400' : isActive ? 'bg-yellow-500/20 text-yellow-500' : 'bg-zinc-800 text-zinc-500'}`}>
                      {isWhale ? '10% COMISIÓN' : lvl.fee}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 mb-3">{lvl.desc}</p>
                  
                  {isActive && (
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      {lvl.target !== null ? (
                        <Button 
                          onClick={() => handleWithdraw(lvl.target as number)}
                          disabled={!canAfford}
                          className={`w-full font-bold ${canAfford ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'bg-zinc-800 text-zinc-500'}`}
                        >
                          {canAfford ? `Retirar $${lvl.target}` : `Faltan $${(lvl.target - usdBalance).toFixed(2)}`}
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Input 
                            type="number" 
                            placeholder="Ej. 50" 
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="bg-zinc-950 border-zinc-800 text-white"
                          />
                          <Button 
                            onClick={handleCustomWithdraw}
                            disabled={!amount || parseFloat(amount) > usdBalance}
                            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold whitespace-nowrap"
                          >
                            Retirar
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Promotional Banners */}
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 mt-8">
            <AlertCircle className="w-5 h-5 text-blue-400" />
            Material Promocional
          </h2>
          <p className="text-zinc-400 text-sm mb-4">
            Usa estos banners en tus redes sociales o sitio web para invitar usuarios y ganar el 100% de comisiones por registro ($1.00 USD por usuario confirmado).
          </p>
          
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors">
              <div className="h-32 bg-gradient-to-r from-pink-500 to-purple-600 flex flex-col items-center justify-center p-4 text-center">
                <h3 className="text-white font-black text-2xl italic tracking-tighter">ESTO ES TAKTAK</h3>
                <p className="text-white/80 font-bold uppercase text-xs mt-1">La Evolución P2P</p>
              </div>
              <div className="p-4 flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-sm">Banner Cuadrado (1080x1080)</p>
                  <p className="text-xs text-zinc-500">Ideal para Instagram</p>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="outline" className="h-8 w-8 rounded-lg border-zinc-700 hover:bg-zinc-800">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 rounded-lg border-zinc-700 hover:bg-zinc-800">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors">
              <div className="h-32 bg-gradient-to-r from-zinc-900 to-black border-b border-yellow-500/20 flex flex-col items-center justify-center p-4 text-center relative">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
                <h3 className="text-yellow-500 font-black text-xl tracking-widest z-10">BILLETERA PRO</h3>
                <p className="text-zinc-400 font-bold uppercase text-xs mt-1 z-10">Sin Intermediarios</p>
              </div>
              <div className="p-4 flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-sm">Banner Web (728x90)</p>
                  <p className="text-xs text-zinc-500">Ideal para Sitios Web</p>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="outline" className="h-8 w-8 rounded-lg border-zinc-700 hover:bg-zinc-800">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 rounded-lg border-zinc-700 hover:bg-zinc-800">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
