import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Search, TrendingUp, Music2, User, 
  Flame, Star, Zap, Globe, Filter
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
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { videos } = useStore();

  const filteredVideos = videos.filter(video => 
    video.caption.toLowerCase().includes(searchQuery.toLowerCase()) ||
    video.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-black overflow-y-auto hide-scrollbar pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar videos, usuarios, hashtags..."
            className="pl-10 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
          />
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
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              {cat.name}
            </button>
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
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
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
            <button className="text-zinc-500">
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
                className="aspect-[3/4] relative bg-zinc-800 rounded-xl overflow-hidden"
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
                className="aspect-square relative bg-zinc-800 cursor-pointer"
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
