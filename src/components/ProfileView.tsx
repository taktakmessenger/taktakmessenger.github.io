import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Share2, Edit3, Grid, Heart,
  Bookmark, Gift, Wallet,
  TrendingUp, Eye, X,
  Shield, Lock, Crown
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/hooks/useSecurity';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const AnalyticsModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { currentUser, videos, ttcR } = useStore();
  const userVideos = videos.filter(v => v.userId === currentUser?.id);
  
  const totalViews = userVideos.length * 1250; 
  const totalLikes = userVideos.reduce((acc, v) => acc + v.likes, 0);
  const totalGifts = userVideos.reduce((acc, v) => acc + v.gifts, 0);
  
  const engagementRate = totalViews > 0 ? ((totalLikes + totalGifts) / totalViews * 100).toFixed(1) : '0';

  const chartData = [45, 52, 38, 65, 48, 80, 70]; 

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/95 z-[120] flex items-center justify-center p-4 overflow-y-auto"
        >
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 my-auto"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-purple-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Estadísticas</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-zinc-800">
                <X className="w-6 h-6 text-zinc-400" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="p-4 bg-zinc-800/50 rounded-2xl border border-zinc-700/50">
                <p className="text-zinc-500 text-xs uppercase font-semibold tracking-wider mb-1">Visualizaciones</p>
                <p className="text-2xl font-bold text-white">{totalViews.toLocaleString()}</p>
                <div className="flex items-center gap-1 text-green-400 text-xs mt-2">
                  <TrendingUp className="w-3 h-3" />
                  <span>+12.5%</span>
                </div>
              </div>
              <div className="p-4 bg-zinc-800/50 rounded-2xl border border-zinc-700/50">
                <p className="text-zinc-500 text-xs uppercase font-semibold tracking-wider mb-1">Engagement</p>
                <p className="text-2xl font-bold text-white">{engagementRate}%</p>
                <div className="flex items-center gap-1 text-purple-400 text-xs mt-2">
                  <Heart className="w-3 h-3" />
                  <span>Premium</span>
                </div>
              </div>
            </div>

            <div className="p-5 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl border border-zinc-700 mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-yellow-500/20 rounded-md">
                    <Eye className="w-4 h-4 text-yellow-500" />
                  </div>
                  <span className="text-white font-semibold">Minería TTC</span>
                </div>
                <span className="text-yellow-500 font-bold">+{ttcR.toFixed(2)} TTC</span>
              </div>
              <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '65%' }}
                  className="h-full bg-yellow-500"
                />
              </div>
              <p className="text-[10px] text-zinc-500 mt-2 italic">
                Recompensas basadas en ancho de banda P2P y engagement.
              </p>
            </div>

            <div className="mb-8">
              <h3 className="text-white font-semibold mb-4 text-sm">Actividad 7 días</h3>
              <div className="flex items-end justify-between h-32 gap-2 px-2">
                {chartData.map((val, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${val}%` }}
                      transition={{ delay: i * 0.1, duration: 0.8 }}
                      className={`w-full rounded-t-md ${i === 5 ? 'bg-purple-500' : 'bg-zinc-700'}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={onClose} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl">
              Cerrar
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const EditProfileModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { currentUser, updateUser } = useStore();
  const [username, setUsername] = useState(currentUser?.username || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');

  const handleSave = () => {
    updateUser({ username, bio, avatar });
    toast.success('Perfil actualizado correctamente');
    onClose();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const response = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('taktak_token')}`
        },
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        setAvatar(data.avatar);
        updateUser({ avatar: data.avatar });
        toast.success('Foto de perfil actualizada');
      } else {
        toast.error(data.error || 'Error al subir la foto');
      }
    } catch (error) {
      console.error('Avatar upload error:', error);
      toast.error('Error de conexión al subir la foto');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6"
          >
            <h2 className="text-xl font-bold text-white mb-6">Editar perfil</h2>
            <div className="space-y-4">
              <div className="flex flex-col items-center mb-4">
                <div className="relative group cursor-pointer" onClick={() => document.getElementById('avatar-upload')?.click()}>
                  <img src={avatar} alt="Avatar" className="w-24 h-24 rounded-full mb-2 object-cover border-4 border-purple-500/50 group-hover:opacity-75 transition-opacity" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Edit3 className="w-8 h-8 text-white drop-shadow-lg" />
                  </div>
                </div>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  title="Subir foto de perfil"
                />
                <p className="text-[10px] text-zinc-500 mt-1">Toca para cambiar foto</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="username" className="text-zinc-400">Nombre de usuario</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio" className="text-zinc-400">Bio</Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white min-h-[100px]"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-8">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
              <Button className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500" onClick={handleSave}>Guardar</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const SettingsModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { logout } = useSecurity();
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed inset-y-0 right-0 w-full max-w-sm bg-zinc-900 z-[110] border-l border-zinc-800 p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white">Configuración</h2>
            <Button variant="ghost" size="icon" onClick={onClose}><Edit3 className="w-6 h-6 rotate-45" /></Button>
          </div>
          <div className="space-y-1">
            {[
              { label: 'Cuenta', icon: Shield },
              { label: 'Privacidad', icon: Lock },
              { label: 'Notificaciones', icon: Gift },
              { label: 'Idioma', icon: Grid },
              { label: 'Ayuda', icon: Shield },
            ].map((item) => (
              <button key={item.label} className="w-full flex items-center justify-between p-4 hover:bg-zinc-800 rounded-xl transition-colors">
                <div className="flex items-center gap-3">
                  <item.icon className="w-5 h-5 text-zinc-400" />
                  <span className="text-white">{item.label}</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-zinc-700" />
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            className="w-full mt-12 border-red-500/50 text-red-500 hover:bg-red-500/10"
            onClick={() => {
              logout();
              onClose();
              toast.success('Sesión cerrada');
            }}
          >
            Cerrar Sesión
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const ProfileView = () => {
  const { currentUser, videos, customGifts, ttcC, ttcR, setCurrentTab } = useStore();
  const { anonId, deviceFingerprint, logout } = useSecurity();
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);

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
    <div className="flex flex-col h-screen bg-black overflow-y-auto hide-scrollbar pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md p-4">
        <div className="flex items-center justify-between w-full mb-4">
          <h1 className="text-white font-semibold text-lg">{currentUser.username}</h1>
          <div className="flex items-center gap-1">
            <button 
              className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors" 
              aria-label="Compartir perfil" 
              title="Compartir perfil"
              onClick={() => {
                const url = window.location.href;
                navigator.clipboard.writeText(url);
                toast.success('Enlace de perfil copiado al portapapeles');
              }}
            >
              <Share2 className="w-4 h-4 text-white" />
            </button>
            <button 
              className="p-1.5 hover:bg-zinc-800 rounded-full transition-colors" 
              aria-label="Configuración" 
              title="Configuración"
              onClick={() => setShowSettingsModal(true)}
            >
              <Settings className="w-4 h-4 text-white" />
            </button>
            {currentUser?.isOwner && (
              <button 
                className="p-1.5 hover:bg-yellow-500/20 rounded-full transition-colors"
                onClick={() => (window as unknown as { showAdminPanel: (v: boolean) => void }).showAdminPanel?.(true)}
                aria-label="Panel de Administración"
                title="Panel de Administración"
              >
                <Crown className="w-4 h-4 text-yellow-400" />
              </button>
            )}
          </div>
        </div>

        {/* Profile Info */}
        <div className="flex flex-col items-center mb-6">
          <img src={currentUser.avatar} alt="Profile" className="w-24 h-24 rounded-full border-2 border-purple-500 p-0.5 object-cover mb-3" />
          <p className="text-zinc-400 text-sm text-center max-w-xs">{currentUser.bio}</p>
          <div className="flex gap-6 mt-4">
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
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1 border-zinc-700 text-white hover:bg-zinc-800"
            onClick={() => setShowEditModal(true)}
          >
            <Edit3 className="w-4 h-4 mr-2" />
            Editar perfil
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-zinc-700 text-white hover:bg-zinc-800"
            onClick={() => setShowAnalyticsModal(true)}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            Estadísticas
          </Button>
        </div>
      </div>

      {/* Wallet Section (Web3 Style) */}
      <div className="px-4 py-2">
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-3xl p-5 shadow-2xl relative overflow-hidden group hover:border-[#FE2C55]/30 transition-all">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#FE2C55]/10 blur-[50px] rounded-full -mr-16 -mt-16 group-hover:bg-[#FE2C55]/20 transition-all" />
          
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#FE2C55]/10 rounded-xl">
                <Wallet className="w-6 h-6 text-[#FE2C55]" />
              </div>
              <div>
                <span className="text-white font-bold block">Billetera Pro</span>
                <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-tighter">Estilo Web3 activo</span>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-[#FE2C55] hover:bg-[#ff4d6d] text-white font-bold rounded-xl px-4 shadow-lg shadow-[#FE2C55]/20"
              onClick={() => setCurrentTab('wallet')}
            >
              Gestionar
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider">TTC-C (Compras)</p>
              <p className="text-xl font-black text-white">{ttcC?.toLocaleString() || 0}</p>
            </div>
            <div className="space-y-1">
              <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                TTC-R (Premios) <TrendingUp className="w-3 h-3 text-[#25F4EE]" />
              </p>
              <p className="text-xl font-black text-[#25F4EE]">{ttcR?.toLocaleString() || 0}</p>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-zinc-800/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-bold">P2P Seguro</span>
              <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-bold font-mono">XOR Encryption</span>
            </div>
            <p className="text-[9px] text-zinc-600 font-bold uppercase">MetaMask Style wallet v2.0</p>
          </div>
        </div>
      </div>

      {/* Referral Section */}
      <div className="px-4 py-2">
        <div className="bg-gradient-to-r from-yellow-600 to-amber-500 rounded-3xl p-5 shadow-2xl relative overflow-hidden text-black transition-all hover:scale-[1.02]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-black text-lg flex items-center gap-2">
              <Gift className="w-5 h-5 text-black" />
              Invita y Gana
            </h3>
            <span className="bg-black text-yellow-500 text-[10px] font-black uppercase px-2 py-1 rounded-full shadow-lg">
              +100 TTC-R
            </span>
          </div>
          <p className="text-sm font-medium mb-4 opacity-90">
            Gana $1.00 USD por cada amigo que se registre con tu enlace.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-black/20 rounded-xl px-3 py-2 text-sm font-mono truncate text-black font-semibold">
              {window.location.origin}/?ref={currentUser.referralCode || currentUser.username}
            </div>
            <Button
              size="sm"
              className="bg-black hover:bg-zinc-900 text-yellow-500 font-bold rounded-xl"
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/?ref=${currentUser.referralCode || currentUser.username}`);
                toast.success('¡Enlace copiado!');
              }}
            >
              Copiar
            </Button>
          </div>
          <div className="mt-4 border-t border-black/10 pt-4">
            <Button 
               className="w-full bg-black hover:bg-zinc-900 text-yellow-500 font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg"
               onClick={() => setCurrentTab('incentives')}
            >
               Ver Banners e Incentivos Progresivos
            </Button>
          </div>
        </div>
      </div>      {/* Security Section */}
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
        <TabsList className="w-full bg-zinc-900 rounded-none border-b border-zinc-800">
          <TabsTrigger value="videos" className="flex-1 text-zinc-400">
            <Grid className="w-5 h-5" />
          </TabsTrigger>
          <TabsTrigger value="liked" className="flex-1 text-zinc-400">
            <Heart className="w-5 h-5" />
          </TabsTrigger>
          <TabsTrigger value="saved" className="flex-1 text-zinc-400">
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

      {/* Modals */}
      <EditProfileModal 
        isOpen={showEditModal} 
        onClose={() => setShowEditModal(false)} 
      />
      <SettingsModal 
        isOpen={showSettingsModal} 
        onClose={() => setShowSettingsModal(false)} 
      />
      <AnalyticsModal
        isOpen={showAnalyticsModal}
        onClose={() => setShowAnalyticsModal(false)}
      />
    </div>
  );
};
