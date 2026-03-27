import { useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  X, RotateCcw, Sparkles, 
  Image, Zap, ZapOff, Gift, DollarSign, ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useStore } from '@/store/useStore';

interface CameraViewProps {
  onClose: () => void;
}

export const CameraView = ({ onClose }: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [isCreatingGift, setIsCreatingGift] = useState(false);
  const [giftName, setGiftName] = useState('');
  const [giftPrice, setGiftPrice] = useState('2.99');
  
  const { addCustomGift, currentUser } = useStore();

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      toast.error('No se pudo acceder a la cámara. Verifica los permisos.');
      console.error('Camera error:', err);
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imageData = canvas.toDataURL('image/png');
        setCapturedImage(imageData);
        stopCamera();
      }
    }
  };

  const retakePhoto = () => {
    setCapturedImage(null);
    startCamera();
  };

  const toggleCamera = () => {
    stopCamera();
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const createGift = () => {
    if (!capturedImage || !giftName.trim()) {
      toast.error('Por favor completa todos los campos');
      return;
    }

    const price = parseFloat(giftPrice);
    if (isNaN(price) || price <= 0) {
      toast.error('Precio inválido');
      return;
    }

    const newGift = {
      id: Date.now().toString(),
      name: giftName,
      image: capturedImage,
      price: price,
      creatorId: currentUser?.id || 'unknown',
      creatorName: currentUser?.username || 'unknown',
      createdAt: new Date().toISOString()
    };

    addCustomGift(newGift);
    toast.success('¡Regalo creado exitosamente! 🎁');
    onClose();
  };

  if (isCreatingGift && capturedImage) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-white flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-gray-100">
          <button onClick={() => setIsCreatingGift(false)} className="p-2 hover:bg-gray-200 rounded-full">
            <ArrowLeft className="w-6 h-6 text-black" />
          </button>
          <h2 className="text-black font-semibold">Crear Regalo</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full">
            <X className="w-6 h-6 text-black" />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="relative">
            <img
              src={capturedImage}
              alt="Captured"
              className="max-w-full max-h-[50vh] rounded-2xl object-contain"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-16 h-16 text-yellow-400 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 bg-gray-100 rounded-t-3xl space-y-4">
          <div>
            <label className="text-gray-600 text-sm mb-2 block">Nombre del regalo</label>
            <Input
              value={giftName}
              onChange={(e) => setGiftName(e.target.value)}
              placeholder="Ej: Mi Foto Especial"
              className="bg-gray-200 border-zinc-700 text-black"
            />
          </div>
          
          <div>
            <label className="text-gray-600 text-sm mb-2 block">Precio (USD)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-600" />
              <Input
                type="number"
                value={giftPrice}
                onChange={(e) => setGiftPrice(e.target.value)}
                className="bg-gray-200 border-zinc-700 text-black pl-10"
                min="0.50"
                step="0.50"
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1">Precio mínimo: $0.50</p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 border-zinc-700 text-black"
              onClick={() => setIsCreatingGift(false)}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Volver
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500"
              onClick={createGift}
            >
              <Gift className="w-4 h-4 mr-2" />
              Crear Regalo
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-white flex flex-col"
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10">
        <button
          onClick={onClose}
          className="p-3 bg-white/50 backdrop-blur-sm rounded-full hover:bg-white/70 transition-colors"
        >
          <X className="w-6 h-6 text-black" />
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => setFlashEnabled(!flashEnabled)}
            className="p-3 bg-white/50 backdrop-blur-sm rounded-full hover:bg-white/70 transition-colors"
          >
            {flashEnabled ? (
              <Zap className="w-5 h-5 text-yellow-400" />
            ) : (
              <ZapOff className="w-5 h-5 text-black" />
            )}
          </button>
          <button
            onClick={toggleCamera}
            className="p-3 bg-white/50 backdrop-blur-sm rounded-full hover:bg-white/70 transition-colors"
          >
            <RotateCcw className="w-5 h-5 text-black" />
          </button>
        </div>
      </div>

      {/* Camera Preview */}
      <div className="flex-1 relative">
        {capturedImage ? (
          <img
            src={capturedImage}
            alt="Captured"
            className="w-full h-full object-cover"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Canvas (hidden) */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Overlay Grid */}
        {!capturedImage && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="w-full h-full flex">
              <div className="flex-1 border-r border-white/20" />
              <div className="flex-1 border-r border-white/20" />
              <div className="flex-1" />
            </div>
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 border-b border-white/20" />
              <div className="flex-1 border-b border-white/20" />
              <div className="flex-1" />
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-6 bg-white">
        {capturedImage ? (
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={retakePhoto}
              className="p-4 bg-gray-200 rounded-full hover:bg-zinc-700 transition-colors"
            >
              <RotateCcw className="w-6 h-6 text-black" />
            </button>
            <button
              onClick={() => setIsCreatingGift(true)}
              className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center gap-2"
            >
              <Gift className="w-5 h-5 text-black" />
              <span className="text-black font-semibold">Crear Regalo</span>
            </button>
            <button
              onClick={() => {
                toast.info('Compartir foto próximamente');
              }}
              className="p-4 bg-gray-200 rounded-full hover:bg-zinc-700 transition-colors"
            >
              <Image className="w-6 h-6 text-black" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <button
              onClick={capturePhoto}
              className="relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:scale-105 transition-transform"
            >
              <div className="w-16 h-16 bg-white rounded-full" />
              <div className="absolute inset-0 rounded-full glow-effect" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};
