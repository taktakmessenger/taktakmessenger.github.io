import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings, Share2, Edit3, Grid, Heart,
  Bookmark, Gift, Wallet, CreditCard,
  TrendingUp, Eye,
  Shield, Lock, Crown
} from 'lucide-react';
import { useStore } from '@/store/useStore';

import { useSecurity } from '@/hooks/useSecurity';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

export const ProfileView = () => {
  const { currentUser, videos, customGifts, balance } = useStore();
  const { anonId, deviceFingerprint, logout } = useSecurity();
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-white">
        <p>No has iniciado sesión</p>
      </div>
    );
  }

  const userVideos = videos.filter(v => v.userId === currentUser.id);
  const likedVideos = videos.filter(v => v.isLiked);



  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div className="flex flex-col h-screen bg-black overflow-y-auto hide-scrollbar">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md p-4 flex items-center justify-between">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-white font-semibold text-lg">{currentUser.username}</h1>
          <div className="flex items-center gap-1">
            <button className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
              <Share2 className="w-4 h-4 text-white" />
            </button>
            <button className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors">
              <Settings className="w-4 h-4 text-white" />
            </button>
            {currentUser?.isOwner && (
              <button 
                className="p-1.5 hover:bg-yellow-500/20 rounded-full transition-colors"
                onClick={() => (window as any).showAdminPanel?.(true)}
              >
                <Crown className="w-4 h-4 text-yellow-400" />
              </button>
            )}
          </div>
        </div>

        {/* Profile Info */}
        <div className="px-4 py-2">
          <p className="text-zinc-400 text-sm mb-3">{currentUser.bio}</p>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-white font-bold">{formatNumber(currentUser.following)}</p>
              <p className="text-zinc-500 text-xs">Siguiendo</p>
            </div>
            <div className="text-center">
              <p className="text-white font-bold">{formatNumber(currentUser.followers)}</p>
              <p className="text-zinc-500 text-xs">Seguidores</p>
            </div>
            <div className="text-center">
              <p className="text-white font-bold">{formatNumber(currentUser.likes)}</p>
              <p className="text-zinc-500 text-xs">Me gusta</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1 border-zinc-700 text-white hover:bg-zinc-800">
            <Edit3 className="w-4 h-4 mr-2" />
            Editar perfil
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-zinc-700 text-white hover:bg-zinc-800"
            onClick={() => toast.info('Próximamente')}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            Estadísticas
          </Button>
        </div>
      </div>

      {/* Wallet Section */}
      <div className="px-4 py-2">
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-white" />
              <span className="text-white font-semibold">Mi Billetera</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toast.info('Recarga próximamente')}
            >
              <CreditCard className="w-4 h-4 mr-1" />
              Recargar
            </Button>
          </div>
          <div className="flex items-end gap-1">
            <span className="text-white/80 text-sm">$</span>
            <span className="text-white text-3xl font-bold">{balance.toFixed(2)}</span>
            <span className="text-white/80 text-sm ml-1">USD</span>
          </div>
          <p className="text-white/60 text-xs mt-1">Saldo disponible para regalos</p>
        </div>
      </div>



      {/* Security Section */}
      <div className="px-4 py-2">
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-400" />
              <span className="text-white font-semibold">Seguridad</span>
            </div>
            <button
              onClick={() => setShowSecurityInfo(!showSecurityInfo)}
              className="text-purple-400 text-xs"
            >
              {showSecurityInfo ? 'Ocultar' : 'Ver detalles'}
            </button>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-green-400" />
            <span className="text-zinc-300 text-sm">Encriptación AES-256 activa</span>
          </div>

          {showSecurityInfo && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 pt-3 border-t border-zinc-800 space-y-2"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">ID Anónimo</span>
                <code className="text-xs text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
                  {anonId?.substring(0, 20)}...
                </code>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Fingerprint</span>
                <code className="text-xs text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
                  {deviceFingerprint?.substring(0, 20)}...
                </code>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">CSRF Protection</span>
                <span className="text-green-400 text-xs">Activo</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Rate Limiting</span>
                <span className="text-green-400 text-xs">Activo</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2 border-red-500/50 text-red-400 hover:bg-red-500/10"
                onClick={() => {
                  logout();
                  toast.success('Sesión cerrada de forma segura');
                }}
              >
                Cerrar sesión segura
              </Button>
            </motion.div>
          )}
        </div>
      </div>

      {/* Custom Gifts Section */}
      {customGifts.length > 0 && (
        <div className="px-4 py-2">
          <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
            <Gift className="w-5 h-5 text-purple-400" />
            Mis Regalos Creados
          </h3>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
            {customGifts.map((gift) => (
              <motion.div
                key={gift.id}
                whileHover={{ scale: 1.05 }}
                className="flex-shrink-0 w-24 bg-zinc-900 rounded-xl p-2 border border-zinc-800"
              >
                <img
                  src={gift.image}
                  alt={gift.name}
                  className="w-full h-20 rounded-lg object-cover mb-2"
                />
                <p className="text-white text-xs font-medium truncate">{gift.name}</p>
                <p className="text-purple-400 text-xs">${gift.price}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Content Tabs */}
      <Tabs defaultValue="videos" className="flex-1">
        <TabsList className="w-full bg-zinc-900 rounded-none">
          <TabsTrigger value="videos" className="flex-1">
            <Grid className="w-5 h-5" />
          </TabsTrigger>
          <TabsTrigger value="liked" className="flex-1">
            <Heart className="w-5 h-5" />
          </TabsTrigger>
          <TabsTrigger value="saved" className="flex-1">
            <Bookmark className="w-5 h-5" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="mt-0">
          <div className="grid grid-cols-3 gap-0.5">
            {userVideos.map((video) => (
              <motion.div
                key={video.id}
                whileHover={{ opacity: 0.8 }}
                className="aspect-[3/4] relative bg-zinc-800"
              >
                <img
                  src={video.thumbnail}
                  alt={video.caption}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 flex items-center gap-1 text-white text-xs">
                  <Eye className="w-3 h-3" />
                  <span>{formatNumber(video.likes)}</span>
                </div>
              </motion.div>
            ))}
            {userVideos.length === 0 && (
              <div className="col-span-3 py-12 text-center text-zinc-500">
                <Grid className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No has subido videos aún</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="liked" className="mt-0">
          <div className="grid grid-cols-3 gap-0.5">
            {likedVideos.map((video) => (
              <motion.div
                key={video.id}
                whileHover={{ opacity: 0.8 }}
                className="aspect-[3/4] relative bg-zinc-800"
              >
                <img
                  src={video.thumbnail}
                  alt={video.caption}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 flex items-center gap-1 text-white text-xs">
                  <Heart className="w-3 h-3 fill-white" />
                  <span>{formatNumber(video.likes)}</span>
                </div>
              </motion.div>
            ))}
            {likedVideos.length === 0 && (
              <div className="col-span-3 py-12 text-center text-zinc-500">
                <Heart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No has dado like a ningún video</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="saved" className="mt-0">
          <div className="col-span-3 py-12 text-center text-zinc-500">
            <Bookmark className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No has guardado ningún video</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
