import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Video, Image, Music, Radio, Upload,
  Play, X, Check, Search, Heart, MessageCircle,
  Share2, UserPlus, TrendingUp, Flame, Clock, Sparkles
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type CreateTab = 'upload' | 'music' | 'live' | 'posts';

const trendingSongs = [
  { id: '1', title: 'Dance Monkey', artist: 'Tones and I', duration: '3:29', plays: '2.3B' },
  { id: '2', title: 'Blinding Lights', artist: 'The Weeknd', duration: '3:20', plays: '3.8B' },
  { id: '3', title: 'Shape of You', artist: 'Ed Sheeran', duration: '3:53', plays: '5.9B' },
  { id: '4', title: 'Despacito', artist: 'Luis Fonsi', duration: '3:58', plays: '8.1B' },
  { id: '5', title: 'Bad Guy', artist: 'Billie Eilish', duration: '3:14', plays: '2.1B' },
  { id: '6', title: 'Levitating', artist: 'Dua Lipa', duration: '3:23', plays: '1.5B' },
  { id: '7', title: 'Stay', artist: 'The Kid LAROI', duration: '2:21', plays: '1.9B' },
  { id: '8', title: 'Peaches', artist: 'Justin Bieber', duration: '3:18', plays: '1.2B' },
];

const suggestedUsers = [
  { id: '1', username: 'creador_pro', avatar: 'https://picsum.photos/200?random=1', followers: '2.5M' },
  { id: '2', username: 'influencer_tiktok', avatar: 'https://picsum.photos/200?random=2', followers: '5.2M' },
  { id: '3', username: 'artista_oficial', avatar: 'https://picsum.photos/200?random=3', followers: '10M' },
  { id: '4', username: 'comediante_local', avatar: 'https://picsum.photos/200?random=4', followers: '800K' },
  { id: '5', username: 'deportista_pro', avatar: 'https://picsum.photos/200?random=5', followers: '3.1M' },
];

interface Post {
  id: string;
  username: string;
  userAvatar: string;
  content: string;
  image?: string;
  likes: number;
  comments: number;
  shares: number;
  createdAt: string;
}

export const CreateView = () => {
  useStore();
  const [activeTab, setActiveTab] = useState<CreateTab>('upload');
  const [selectedSong, setSelectedSong] = useState<typeof trendingSongs[0] | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [posts] = useState<Post[]>([
    {
      id: '1',
      username: 'usuario_tiktok',
      userAvatar: 'https://picsum.photos/200?random=10',
      content: 'Increíble video nuevo 🎬 #viral #tiktok',
      image: 'https://picsum.photos/400/600?random=11',
      likes: 12500,
      comments: 342,
      shares: 89,
      createdAt: '2h'
    },
    {
      id: '2',
      username: 'creador_contenido',
      userAvatar: 'https://picsum.photos/200?random=12',
      content: 'Dale play y dime qué opinas 👀',
      image: 'https://picsum.photos/400/600?random=13',
      likes: 8900,
      comments: 156,
      shares: 45,
      createdAt: '5h'
    },
    {
      id: '3',
      username: 'estrella_tiktok',
      userAvatar: 'https://picsum.photos/200?random=14',
      content: 'Tutorial: cómo hacer esto 🔥',
      likes: 45000,
      comments: 1200,
      shares: 890,
      createdAt: '1d'
    },
  ]);

  const handleUpload = () => {
    if (!caption.trim()) {
      toast.error('Escribe una descripción para tu video');
      return;
    }
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setShowUploadModal(false);
      setCaption('');
      toast.success('¡Video subido exitosamente! 🎉');
    }, 2000);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const renderUploadTab = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-zinc-900 border-b border-zinc-800">
        <h1 className="text-2xl font-bold text-white mb-4">Crear contenido</h1>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowUploadModal(true)}
            className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500"
          >
            <Upload className="w-4 h-4 mr-2" />
            Subir video
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-purple-500 text-purple-400"
            onClick={() => setActiveTab('live')}
          >
            <Radio className="w-4 h-4 mr-2" />
            En vivo
          </Button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-4 p-4">
        {[
          { icon: Video, label: 'Video', color: 'bg-pink-500' },
          { icon: Image, label: 'Foto', color: 'bg-purple-500' },
          { icon: Music, label: 'Sonido', color: 'bg-blue-500' },
          { icon: Radio, label: 'En vivo', color: 'bg-red-500' },
        ].map((action, i) => (
          <motion.button
            key={i}
            whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center gap-2"
            onClick={() => {
              if (action.label === 'Video' || action.label === 'Foto') setShowUploadModal(true);
              else if (action.label === 'Sonido') setActiveTab('music');
              else setActiveTab('live');
            }}
          >
            <div className={`w-14 h-14 ${action.color} rounded-2xl flex items-center justify-center`}>
              <action.icon className="w-6 h-6 text-white" />
            </div>
            <span className="text-xs text-zinc-400">{action.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Posts Feed */}
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-lg font-semibold text-white mb-4">Para ti</h2>
        <div className="space-y-4">
          {posts.map((post) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900 rounded-xl overflow-hidden"
            >
              {post.image && (
                <img src={post.image} alt="" className="w-full h-48 object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <img
                    src={post.userAvatar}
                    alt={post.username}
                    className="w-10 h-10 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">@{post.username}</p>
                    <p className="text-zinc-500 text-xs">{post.createdAt}</p>
                  </div>
                  <Button size="sm" className="bg-red-500 hover:bg-red-600">
                    <UserPlus className="w-4 h-4 mr-1" />
                    Seguir
                  </Button>
                </div>
                <p className="text-white text-sm mb-3">{post.content}</p>
                <div className="flex items-center gap-4 text-zinc-400">
                  <button className="flex items-center gap-1">
                    <Heart className="w-4 h-4" />
                    <span className="text-xs">{formatNumber(post.likes)}</span>
                  </button>
                  <button className="flex items-center gap-1">
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-xs">{formatNumber(post.comments)}</span>
                  </button>
                  <button className="flex items-center gap-1">
                    <Share2 className="w-4 h-4" />
                    <span className="text-xs">{formatNumber(post.shares)}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 rounded-2xl w-full max-w-md p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">Subir video</h2>
                <button onClick={() => setShowUploadModal(false)}>
                  <X className="w-6 h-6 text-zinc-400" />
                </button>
              </div>

              <div className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center mb-4">
                <Video className="w-12 h-12 text-zinc-500 mx-auto mb-2" />
                <p className="text-white mb-2">Selecciona un video</p>
                <p className="text-zinc-500 text-sm">MP4, MOV hasta 287MB</p>
                <Button className="mt-4 bg-purple-500 hover:bg-purple-600">
                  <Upload className="w-4 h-4 mr-2" />
                  Elegir archivo
                </Button>
              </div>

              {selectedSong && (
                <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg mb-4">
                  <Music className="w-5 h-5 text-purple-400" />
                  <div className="flex-1">
                    <p className="text-white text-sm">{selectedSong.title}</p>
                    <p className="text-zinc-500 text-xs">{selectedSong.artist}</p>
                  </div>
                  <button onClick={() => setSelectedSong(null)}>
                    <X className="w-4 h-4 text-zinc-400" />
                  </button>
                </div>
              )}

              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Escribe una descripción..."
                className="bg-zinc-800 border-zinc-700 text-white mb-4"
              />

              <Button
                onClick={handleUpload}
                disabled={isUploading}
                className="w-full bg-gradient-to-r from-pink-500 to-purple-500"
              >
                {isUploading ? (
                  'Subiendo...'
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Publicar
                  </>
                )}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderMusicTab = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveTab('upload')}>
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-xl font-bold text-white">Música</h1>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Buscar canciones..."
            className="pl-10 bg-zinc-800 border-zinc-700 text-white"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex gap-2 p-4 overflow-x-auto">
        {['Todas', 'Tendencias', 'Favoritas', 'Recientes', 'Fiesta', 'Relax'].map((cat, i) => (
          <button
            key={cat}
            className={`px-4 py-2 rounded-full text-sm whitespace-nowrap ${
              i === 0 ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Trending Songs */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold text-white">Tendencias</h2>
        </div>
        <div className="space-y-3">
          {trendingSongs.map((song, i) => (
            <motion.div
              key={song.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 p-3 bg-zinc-900 rounded-xl hover:bg-zinc-800 cursor-pointer"
              onClick={() => setSelectedSong(song)}
            >
              <span className="text-zinc-500 font-bold w-6">{i + 1}</span>
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Play className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">{song.title}</p>
                <p className="text-zinc-500 text-sm">{song.artist}</p>
              </div>
              <div className="text-right">
                <p className="text-purple-400 text-sm">🎵 {song.plays}</p>
                <p className="text-zinc-500 text-xs">{song.duration}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Use Song Button */}
      {selectedSong && (
        <div className="p-4 bg-zinc-900 border-t border-zinc-800">
          <Button
            className="w-full bg-gradient-to-r from-pink-500 to-purple-500"
            onClick={() => {
              setActiveTab('upload');
              setShowUploadModal(true);
            }}
          >
            <Music className="w-4 h-4 mr-2" />
            Usar sonido
          </Button>
        </div>
      )}
    </div>
  );

  const renderLiveTab = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveTab('upload')}>
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-xl font-bold text-white">En vivo</h1>
        </div>
      </div>

      {/* Live Preview */}
      <div className="flex-1 p-4">
        <div className="aspect-video bg-gradient-to-br from-purple-900 to-pink-900 rounded-2xl flex items-center justify-center mb-6">
          <div className="text-center">
            <Radio className="w-16 h-16 text-white/50 mx-auto mb-4 animate-pulse" />
            <p className="text-white text-lg">Vista previa</p>
            <p className="text-white/50 text-sm">Configura tu transmisión</p>
          </div>
        </div>

        {/* Live Settings */}
        <div className="space-y-4">
          <div>
            <label className="text-zinc-400 text-sm mb-2 block">Título de la transmisión</label>
            <Input
              placeholder="¿Sobre qué vas a transmitir?"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>

          <div>
            <label className="text-zinc-400 text-sm mb-2 block">Categoría</label>
            <div className="grid grid-cols-3 gap-2">
              {['Gaming', 'Baile', 'Chat', 'Música', 'Deportes', 'Arte'].map((cat) => (
                <button
                  key={cat}
                  className="p-3 bg-zinc-800 rounded-lg text-zinc-400 text-sm hover:bg-zinc-700"
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <Button
            className="w-full bg-gradient-to-r from-red-500 to-pink-500 py-6"
            onClick={() => toast.success('¡Transmisión iniciada! 📡')}
          >
            <Radio className="w-5 h-5 mr-2" />
            Iniciar transmisión
          </Button>
        </div>
      </div>

      {/* Suggested Users */}
      <div className="p-4 bg-zinc-900 border-t border-zinc-800">
        <h3 className="text-white font-semibold mb-3">Usuarios en vivo</h3>
        <div className="flex gap-3 overflow-x-auto">
          {suggestedUsers.slice(0, 5).map((user) => (
            <div key={user.id} className="flex flex-col items-center gap-2">
              <div className="relative">
                <img
                  src={user.avatar}
                  alt={user.username}
                  className="w-14 h-14 rounded-full"
                />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                </div>
              </div>
              <span className="text-xs text-zinc-400">@{user.username.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderPostsTab = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 bg-zinc-900 border-b border-zinc-800">
        <h1 className="text-2xl font-bold text-white mb-4">Foros</h1>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { icon: TrendingUp, label: 'Tendencias', active: true },
            { icon: Flame, label: 'Popular', active: false },
            { icon: Clock, label: 'Recientes', active: false },
            { icon: Sparkles, label: 'Segui2', active: false },
          ].map((tab) => (
            <button
              key={tab.label}
              className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap ${
                tab.active ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Posts Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {posts.map((post) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative aspect-[3/4] rounded-xl overflow-hidden"
            >
              {post.image ? (
                <img src={post.image} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                  <MessageCircle className="w-8 h-8 text-zinc-600" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-2 left-2 right-2">
                <p className="text-white text-sm font-medium truncate">@{post.username}</p>
                <div className="flex items-center gap-2 text-white/70 text-xs">
                  <Heart className="w-3 h-3" />
                  {formatNumber(post.likes)}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Create Post Button */}
      <div className="p-4 bg-zinc-900 border-t border-zinc-800">
        <Button
          className="w-full bg-gradient-to-r from-purple-500 to-pink-500"
          onClick={() => {
            setActiveTab('upload');
            setShowUploadModal(true);
          }}
        >
          <Upload className="w-4 h-4 mr-2" />
          Crear post
        </Button>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-black">
      {activeTab === 'upload' && renderUploadTab()}
      {activeTab === 'music' && renderMusicTab()}
      {activeTab === 'live' && renderLiveTab()}
      {activeTab === 'posts' && renderPostsTab()}
    </div>
  );
};
