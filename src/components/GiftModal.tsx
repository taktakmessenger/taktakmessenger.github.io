import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Camera, Sparkles, CreditCard, Wallet, DollarSign } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { CameraView } from './CameraView';

interface GiftModalProps {
  videoId: string;
  onClose: () => void;
}

export const GiftModal = ({ videoId, onClose }: GiftModalProps) => {
  const { gifts, customGifts, balance, sendGift, addBalance, addEarnings } = useStore();
  const [selectedGift, setSelectedGift] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [showCamera, setShowCamera] = useState(false);

  const handleSendGift = () => {
    if (!selectedGift) return;

    const gift = gifts.find(g => g.id === selectedGift) || customGifts.find(g => g.id === selectedGift);
    if (!gift) return;

    if (balance < gift.price) {
      toast.error('Saldo insuficiente. Recarga tu cuenta.');
      setShowPayment(true);
      setPaymentAmount(gift.price - balance);
      return;
    }

    sendGift(videoId, selectedGift);
    addEarnings(gift.price * 0.3); // para el admin
    toast.success(`¡Regalo "${gift.name}" enviado con éxito! 🎁`);
    onClose();
  };

  const handleRecharge = (amount: number) => {
    addBalance(amount);
    toast.success(`¡Recarga de $${amount} exitosa!`);
    setShowPayment(false);
  };

  if (showPayment) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Recargar Saldo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-zinc-400 mb-2">Saldo actual</p>
              <p className="text-3xl font-bold gradient-text">${balance.toFixed(2)}</p>
            </div>

            <p className="text-sm text-zinc-400">
              Necesitas ${paymentAmount.toFixed(2)} más para enviar este regalo.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {[5, 10, 20, 50].map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleRecharge(amount)}
                  className="p-4 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors flex flex-col items-center gap-2"
                >
                  <DollarSign className="w-6 h-6 text-green-400" />
                  <span className="font-semibold">${amount}</span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-zinc-400">Métodos de pago</p>
              <div className="flex gap-2">
                <div className="flex-1 p-3 bg-zinc-800 rounded-lg flex items-center justify-center gap-2">
                  <CreditCard className="w-5 h-5 text-blue-400" />
                  <span className="text-sm">Tarjeta</span>
                </div>
                <div className="flex-1 p-3 bg-zinc-800 rounded-lg flex items-center justify-center gap-2">
                  <Wallet className="w-5 h-5 text-purple-400" />
                  <span className="text-sm">Zinli</span>
                </div>
              </div>
            </div>


          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed inset-x-0 bottom-0 z-50 bg-zinc-900 rounded-t-3xl border-t border-zinc-800"
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">Enviar Regalo</h3>
            <p className="text-sm text-zinc-400">Saldo: ${balance.toFixed(2)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <Tabs defaultValue="gifts" className="w-full">
          <TabsList className="w-full bg-zinc-800 mb-4">
            <TabsTrigger value="gifts" className="flex-1">Regalos</TabsTrigger>
            <TabsTrigger value="custom" className="flex-1">Personalizados</TabsTrigger>
            <TabsTrigger value="create" className="flex-1">Crear</TabsTrigger>
          </TabsList>

          <TabsContent value="gifts" className="mt-0">
            <div className="grid grid-cols-3 gap-3 max-h-[300px] overflow-y-auto">
              {gifts.map((gift) => (
                <button
                  key={gift.id}
                  onClick={() => setSelectedGift(gift.id)}
                  className={`p-4 rounded-xl transition-all ${selectedGift === gift.id
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 ring-2 ring-white'
                      : 'bg-zinc-800 hover:bg-zinc-700'
                    }`}
                >
                  <div className="text-4xl mb-2">{gift.image}</div>
                  <p className="text-white text-sm font-medium truncate">{gift.name}</p>
                  <p className="text-zinc-400 text-xs">${gift.price}</p>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="custom" className="mt-0">
            <div className="grid grid-cols-3 gap-3 max-h-[300px] overflow-y-auto">
              {customGifts.length > 0 ? (
                customGifts.map((gift) => (
                  <button
                    key={gift.id}
                    onClick={() => setSelectedGift(gift.id)}
                    className={`p-4 rounded-xl transition-all ${selectedGift === gift.id
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 ring-2 ring-white'
                        : 'bg-zinc-800 hover:bg-zinc-700'
                      }`}
                  >
                    <img src={gift.image} alt={gift.name} className="w-12 h-12 rounded-lg mx-auto mb-2 object-cover" />
                    <p className="text-white text-sm font-medium truncate">{gift.name}</p>
                    <p className="text-zinc-400 text-xs">${gift.price}</p>
                  </button>
                ))
              ) : (
                <div className="col-span-3 text-center py-8 text-zinc-500">
                  <Sparkles className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No hay regalos personalizados aún</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="create" className="mt-0">
            <div className="text-center py-8">
              <Camera className="w-16 h-16 mx-auto mb-4 text-purple-400" />
              <h4 className="text-white font-semibold mb-2">Crea tu propio regalo</h4>
              <p className="text-zinc-400 text-sm mb-4">Toma una foto y conviértela en un regalo único</p>
              <Button
                onClick={() => setShowCamera(true)}
                className="bg-gradient-to-r from-purple-500 to-pink-500"
              >
                <Camera className="w-4 h-4 mr-2" />
                Abrir Cámara
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Send Button */}
        {selectedGift && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4"
          >
            <Button
              onClick={handleSendGift}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-6"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Enviar Regalo
            </Button>
          </motion.div>
        )}
      </div>

      {/* Camera Modal */}
      {showCamera && (
        <CameraView onClose={() => setShowCamera(false)} />
      )}
    </motion.div>
  );
};
