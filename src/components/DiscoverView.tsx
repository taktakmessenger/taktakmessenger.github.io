import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Search, TrendingUp, Music2, User, 
  Flame, Star, Zap, Globe, Filter, Hash, Play,
  MessageCircle, Download
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';

const trendingTopics = [
  { id: '1', tag: '#viral', posts: '2.5M', icon: Flame },
  { id: '2', tag: '#baile', posts: '1.8M', icon: Music2 },
  { id: '3', tag: '#comedia', posts: '980K', icon: Star },
  { id: '4', tag: '#tendencia', posts: '750K', icon: TrendingUp },
  { id: '5', tag: '#musica', posts: '2.1M', icon: Music2 },
  { id: '6', tag: '#challenge', posts: '1.2M', icon: Zap },
];

const suggestedUsers = [
  { id: '1', username: 'creator_pro', followers: '1.2M', avatar: 'https://i.pravatar.cc/150?u=s1', isVerified: true },
  { id: '2', username: 'dance_master', followers: '890K', avatar: 'https://i.pravatar.cc/150?u=s2', isVerified: true },
  { id: '3', username: 'funny_guy', followers: '2.1M', avatar: 'https://i.pravatar.cc/150?u=s3', isVerified: false },
  { id: '4', username: 'music_star', followers: '3.5M', avatar: 'https://i.pravatar.cc/150?u=s4', isVerified: true },
];

const categories = [
  { id: 'all', name: 'Todo', color: 'from-purple-500 to-pink-500' },
  { id: 'dance', name: 'Baile', color: 'from-blue-500 to-cyan-500' },
  { id: 'comedy', name: 'Comedia', color: 'from-yellow-500 to-orange-500' },
  { id: 'music', name: 'Música', color: 'from-green-500 to-emerald-500' },
  { id: 'sports', name: 'Deportes', color: 'from-red-500 to-rose-500' },
  { id: 'food', name: 'Comida', color: 'from-orange-500 to-amber-500' },
];

export const DiscoverView = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { videos, setCurrentTab } = useStore();

  const filteredVideos = videos.filter(video => 
    video.caption.toLowerCase().includes(searchQuery.toLowerCase()) ||
    video.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Mock dropdown results similar to TopHeader
  const searchResults = [
    { type: 'user', username: 'creator_pro', name: 'Creator Pro', avatar: 'https://i.pravatar.cc/150?u=s1' },
    { type: 'hashtag', name: 'viral', views: '2.5B' },
    { type: 'user', username: 'dance_master', name: 'Dance Master', avatar: 'https://i.pravatar.cc/150?u=s2' },
    { type: 'hashtag', name: 'tendencia', views: '800M' },
  ].filter(r => 
    r.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-black overflow-y-auto hide-scrollbar pb-20 relative">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-md p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder="Buscar videos, usuarios, hashtags..."
            className="pl-10 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
          />
          {/* Dropdown Results */}
          {showResults && searchQuery.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
              {searchResults.length > 0 ? (
                <div className="max-h-60 overflow-y-auto python pb-2">
                  {searchResults.map((result, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 cursor-pointer transition-colors"
                      onClick={() => {
                        setShowResults(false);
                        toast.info(`Buscando ${result.name}`);
                      }}
                    >
                      {result.type === 'user' ? (
                        <>
                          <img src={result.avatar} alt={result.username} className="w-10 h-10 rounded-full object-cover" />
                          <div className="text-left">
                            <p className="text-white font-medium text-sm">@{result.username}</p>
                            <p className="text-zinc-500 text-xs">{result.name}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                            <Hash className="w-5 h-5 text-white" />
                          </div>
                          <div className="text-left">
                            <p className="text-white font-medium text-sm">#{result.name}</p>
                            <p className="text-zinc-500 text-xs">{result.views} visualizaciones</p>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-zinc-500 text-sm">
                  No se encontraron resultados para "{searchQuery}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Categories */}
      <div className="px-4 py-2">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedCategory === cat.id
                  ? `bg-gradient-to-r ${cat.color} text-white`
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Weekly Challenges */}
      <div className="px-4 py-2 mt-2">
        <motion.div 
          whileHover={{ scale: 1.01 }}
          className="relative h-40 rounded-2xl overflow-hidden bg-gradient-to-r from-purple-900 via-pink-900 to-red-900 border border-white/10"
        >
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute inset-0 p-6 flex flex-col justify-center">
            <span className="bg-red-500 text-[10px] font-bold text-white px-2 py-0.5 rounded-full w-fit mb-2">HOT CHALLENGE</span>
            <h2 className="text-2xl font-black text-white italic tracking-tighter">#TakTakDance2026</h2>
            <p className="text-white/70 text-sm mt-1">¡Gana hasta 5000 TTC participando!</p>
            <Button size="sm" className="mt-4 w-fit bg-white text-black hover:bg-zinc-200">Participar ahora</Button>
          </div>
        </motion.div>
      </div>

      {/* WhaTaka Branding Card */}
      <div className="px-4 py-2 mt-2">
        <motion.div 
          whileHover={{ scale: 1.01 }}
          onClick={() => setCurrentTab('whataka')}
          className="relative h-44 rounded-2xl overflow-hidden bg-gradient-to-br from-purple-900 via-black to-purple-950 border border-yellow-500/30 cursor-pointer shadow-[0_0_25px_rgba(168,85,247,0.2)] group"
        >
          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
          <div className="absolute inset-0 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-black border-2 border-yellow-500 rounded-full flex items-center justify-center font-black text-white text-xs shadow-lg">
                  WT
                </div>
                <h2 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-yellow-500 italic">WhaTaka</h2>
              </div>
              <p className="text-purple-200/80 text-sm mt-3 font-medium max-w-[220px]">Mensajería P2P descentralizada de TakTak</p>
            </div>
            <div className="flex items-center gap-2 text-yellow-500 font-bold text-sm">
              <MessageCircle className="w-5 h-5" />
              <span>Abrir Mensajería</span>
            </div>
          </div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-10 group-hover:opacity-20 transition-opacity">
            <div className="w-28 h-28 bg-gradient-to-br from-purple-600 to-black border-2 border-yellow-500/30 rounded-full flex items-center justify-center font-black text-white text-4xl rotate-12">
              WT
            </div>
          </div>
        </motion.div>
      </div>

      {/* Download Section */}
      <div className="px-4 py-2">
        <div className="bg-zinc-900/80 border border-purple-900/30 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-900 to-black rounded-lg flex items-center justify-center border border-purple-700/30">
              <Download className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h4 className="text-white text-xs font-bold uppercase tracking-wider">¿Solo quieres WhaTaka?</h4>
              <p className="text-zinc-500 text-[10px]">Descarga la aplicación telefónica</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="text-xs h-8 bg-black hover:bg-purple-900/30 text-purple-400 border-purple-500/30" onClick={() => setCurrentTab('whataka-download')}>
            Descargar
          </Button>
        </div>
      </div>

      {/* Popular Sounds */}
      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Music2 className="w-5 h-5 text-pink-400" />
            Sonidos Populares
          </h3>
          <button className="text-pink-400 text-xs font-medium">Explorar sonidos</button>
        </div>
        <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-2">
          {[
            { id: '1', name: 'Original Sound', artist: 'Dua Lipa', img: 'https://picsum.photos/200?random=10' },
            { id: '2', name: 'Cyberpunk Mix', artist: 'Night City', img: 'https://picsum.photos/200?random=11' },
            { id: '3', name: 'TTC Vibes', artist: 'CryptoBeat', img: 'https://picsum.photos/200?random=12' },
            { id: '4', name: 'Magic Car', artist: 'Racer X', img: 'https://picsum.photos/200?random=13' },
          ].map((sound) => (
            <div key={sound.id} className="flex-shrink-0 w-28 group cursor-pointer">
              <div className="relative aspect-square rounded-xl overflow-hidden mb-2">
                <img src={sound.img} alt={sound.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="w-8 h-8 text-white fill-white" />
                </div>
              </div>
              <p className="text-white text-[11px] font-bold truncate">{sound.name}</p>
              <p className="text-zinc-500 text-[10px] truncate">{sound.artist}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Trending Topics */}
      {!searchQuery && (
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-red-400" />
              Tendencias
            </h3>
            <button 
              className="text-purple-400 text-sm"
              onClick={() => toast.info('Ver todas las tendencias')}
            >
              Ver todo
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {trendingTopics.map((topic, index) => {
              const Icon = topic.icon;
              return (
                <motion.button
                  key={topic.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => toast.info(`Buscando ${topic.tag}`)}
                  className="p-3 bg-zinc-900 rounded-xl flex items-center gap-3 hover:bg-zinc-800 transition-colors"
                >
                  <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                    <Icon className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-medium text-sm">{topic.tag}</p>
                    <p className="text-zinc-500 text-xs">{topic.posts} posts</p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggested Users */}
      {!searchQuery && (
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <User className="w-5 h-5 text-blue-400" />
              Creadores Destacados
            </h3>
            <button 
              className="text-purple-400 text-sm"
              onClick={() => toast.info('Ver todos los creadores')}
            >
              Ver todo
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
            {suggestedUsers.map((user) => (
              <motion.button
                key={user.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => toast.info(`Ver perfil de ${user.username}`)}
                className="flex-shrink-0 w-32 bg-zinc-900 rounded-xl p-3 text-center hover:bg-zinc-800 transition-colors"
              >
                <div className="relative inline-block">
                  <img
                    src={user.avatar}
                    alt={user.username}
                    className="w-16 h-16 rounded-full object-cover mx-auto mb-2"
                  />
                  {user.isVerified && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="text-white font-medium text-sm truncate">@{user.username}</p>
                <p className="text-zinc-500 text-xs">{user.followers}</p>
                <Button 
                  size="sm" 
                  className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 text-white text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.success(`Siguiendo a ${user.username}`);
                  }}
                >
                  Seguir
                </Button>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Search Results */}
      {searchQuery && (
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">
              Resultados de búsqueda
            </h3>
            <button className="text-zinc-500" aria-label="Filtrar" title="Filtrar">
              <Filter className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {filteredVideos.map((video) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                whileHover={{ scale: 1.02 }}
                className="aspect-[3/4] relative bg-zinc-900 rounded-xl overflow-hidden"
              >
                <img
                  src={video.thumbnail}
                  alt={video.caption}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <p className="text-white text-xs font-medium truncate">@{video.username}</p>
                  <p className="text-zinc-300 text-xs truncate">{video.caption}</p>
                </div>
              </motion.div>
            ))}
            {filteredVideos.length === 0 && (
              <div className="col-span-2 py-12 text-center text-zinc-500">
                <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No se encontraron resultados</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Explore Grid */}
      {!searchQuery && (
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Globe className="w-5 h-5 text-green-400" />
              Explorar
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-0.5">
            {videos.map((video, index) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ opacity: 0.8 }}
                className="aspect-square relative bg-zinc-900 cursor-pointer"
                onClick={() => toast.info(`Reproduciendo video de ${video.username}`)}
              >
                <img
                  src={video.thumbnail}
                  alt={video.caption}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/40">
                  <div className="text-center">
                    <TrendingUp className="w-6 h-6 text-white mx-auto" />
                    <p className="text-white text-xs mt-1">{video.likes}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
