import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Video, Image, Music, Radio, Upload,
  Play, X, Check, Search, Heart, MessageCircle,
  Share2, UserPlus, TrendingUp, Flame, Clock, Sparkles,
  Camera, Filter, Wand2, Monitor, Mic, MicOff
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
  const { addVideo, currentUser } = useStore();
  const [activeTab, setActiveTab] = useState<CreateTab>('upload');
  const [selectedSong, setSelectedSong] = useState<typeof trendingSongs[0] | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  // New states from TikTok Clone UI
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [liveChat, setLiveChat] = useState<{user: string, message: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
      setUploadProgress(0);
    } else {
      toast.error('Por favor, selecciona un archivo de video válido.');
    }
  };

  const handleUpload = async () => {
    if (!videoFile) {
      toast.error('Selecciona un video primero');
      return;
    }
    if (!caption.trim()) {
      toast.error('Escribe una descripción para tu video');
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);

    const formData = new FormData();
    formData.append('video', videoFile);
    formData.append('caption', caption);

    try {
      const response = await fetch('/api/videos/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('taktak_token')}`
        },
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        addVideo(data.video);
        setIsUploading(false);
        setShowUploadModal(false);
        setCaption('');
        setVideoFile(null);
        setVideoPreview(null);
        setUploadProgress(0);
        toast.success('¡Video subido exitosamente! 🎉');
      } else {
        toast.error(data.error || 'Error al subir el video');
        setIsUploading(false);
      }
    } catch (error) {
      console.error('Video upload error:', error);
      toast.error('Error de conexión al subir el video');
      setIsUploading(false);
    }
  };

  const startLivePreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' }, 
        audio: true 
      });
      setLiveStream(stream);
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Live Preview Error:', err);
      toast.error('No se pudo acceder a la cámara para el Live');
    }
  };

  const stopLivePreview = () => {
    if (liveStream) {
      liveStream.getTracks().forEach(track => track.stop());
      setLiveStream(null);
    }
  };

  const toggleMute = () => {
    if (liveStream) {
      const audioTrack = liveStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        toast.info(audioTrack.enabled ? 'Micrófono activado' : 'Micrófono silenciado');
      }
    }
  };

  const handleGoLive = () => {
    if (!liveStream) {
      toast.error('Activa la cámara primero');
      return;
    }
    setIsLive(!isLive);
    if (!isLive) {
      toast.success('¡Ahora estás en directo! 📡');
      setViewerCount(Math.floor(Math.random() * 10) + 1);
      // Mock chat messages
      setTimeout(() => setLiveChat([{ user: 'Admin', message: '¡Bienvenidos al live de ' + currentUser?.username + '!' }]), 1000);
      // Simulate viewer growth
      const interval = setInterval(() => {
        setViewerCount(prev => prev + Math.floor(Math.random() * 5));
      }, 5000);
      (window as any).liveInterval = interval;
    } else {
      toast.info('Transmisión finalizada');
      clearInterval((window as any).liveInterval);
      setViewerCount(0);
      stopLivePreview();
    }
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    setLiveChat(prev => [...prev, { user: currentUser?.username || 'Yo', message: chatInput }]);
    setChatInput('');
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
            Nuevo video
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-purple-500 text-purple-400"
            onClick={() => setActiveTab('live')}
          >
            <Radio className="w-4 h-4 mr-2" />
            Ir al En Vivo
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
            aria-label={action.label}
            title={action.label}
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
                  <button className="flex items-center gap-1" aria-label="Comentarios" title="Comentarios">
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-xs">{formatNumber(post.comments)}</span>
                  </button>
                  <button className="flex items-center gap-1" aria-label="Compartir" title="Compartir">
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
                <button onClick={() => setShowUploadModal(false)} aria-label="Cerrar" title="Cerrar">
                  <X className="w-6 h-6 text-zinc-400" />
                </button>
              </div>

              {!videoPreview ? (
                <div 
                  className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center mb-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Video className="w-12 h-12 text-zinc-500 mx-auto mb-2" />
                  <p className="text-white mb-2">Selecciona un video para subir</p>
                  <p className="text-zinc-500 text-sm mb-4">MP4, MOV hasta 287MB</p>
                  <Button 
                    className="bg-purple-500 hover:bg-purple-600 pointer-events-none"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Elegir archivo
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="video-upload"
                    title="Seleccionar archivo de video"
                  />
                </div>
              ) : (
                <div className="relative mb-4 bg-black rounded-xl overflow-hidden aspect-[9/16] max-h-[40vh] mx-auto flex items-center justify-center group">
                  <video 
                    src={videoPreview} 
                    className="w-full h-full object-contain"
                    controls
                  />
                  {!isUploading && (
                    <button 
                      onClick={() => {
                        setVideoFile(null);
                        setVideoPreview(null);
                      }}
                      className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white backdrop-blur-sm transition-colors z-10 opacity-0 group-hover:opacity-100"
                      aria-label="Eliminar video"
                      title="Eliminar video"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {selectedSong && (
                <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg mb-4 border border-purple-500/30">
                  <Music className="w-5 h-5 text-purple-400" />
                  <div className="flex-1">
                    <p className="text-white text-sm">{selectedSong.title}</p>
                    <p className="text-zinc-500 text-xs">{selectedSong.artist}</p>
                  </div>
                  <button onClick={() => setSelectedSong(null)} aria-label="Quitar canción" title="Quitar canción">
                    <X className="w-4 h-4 text-zinc-400" />
                  </button>
                </div>
              )}

              {/* Effects/Filters Simulation */}
              <div className="mb-4">
                <p className="text-zinc-400 text-xs mb-2 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Filtros y Efectos
                </p>
                <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                  {[
                    { name: 'Original', color: 'bg-zinc-700' },
                    { name: 'Cyber', color: 'bg-cyan-500' },
                    { name: 'Retro', color: 'bg-orange-400' },
                    { name: 'B&W', color: 'bg-white' },
                    { name: 'Magic', color: 'bg-purple-500' },
                  ].map((filter) => (
                    <button
                      key={filter.name}
                      className="flex-shrink-0 flex flex-col items-center gap-1"
                      onClick={() => toast.success(`Filtro ${filter.name} aplicado`)}
                    >
                      <div className={`w-10 h-10 rounded-lg ${filter.color} opacity-40 hover:opacity-100 transition-opacity border border-white/20`} />
                      <span className="text-[10px] text-zinc-500">{filter.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Escribe una descripción..."
                className="bg-zinc-800 border-zinc-700 text-white mb-4"
              />

              {isUploading && uploadProgress > 0 && (
                <div className="mb-4">
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-right text-xs text-zinc-500 mt-1">{uploadProgress}% compitiendo P2P...</p>
                </div>
              )}

              <Button
                onClick={handleUpload}
                disabled={isUploading || !videoPreview}
                className="w-full bg-gradient-to-r from-pink-500 to-purple-500"
              >
                {isUploading ? (
                  'Subiendo...'
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Publicar en TakTak
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
          <button onClick={() => setActiveTab('upload')} aria-label="Volver" title="Volver">
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
    <div className="flex flex-col h-full bg-black relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center gap-3 z-30 bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={() => { stopLivePreview(); setActiveTab('upload'); }} aria-label="Volver" title="Volver">
          <ArrowLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="text-xl font-bold text-white">Emitir en Directo</h1>
      </div>

      {/* Live Preview / Camera */}
      <div className="flex-1 relative flex items-center justify-center bg-zinc-900 overflow-hidden">
        {liveStream ? (
          <video
            ref={liveVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center p-8">
            <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-dashed border-zinc-600">
              <Camera className="w-10 h-10 text-zinc-500" />
            </div>
            <p className="text-white font-medium mb-4">La cámara está apagada</p>
            <Button onClick={startLivePreview} className="bg-[#FE2C55]">
              Activar Cámara
            </Button>
          </div>
        )}

        {/* Live Chat Overlay */}
        <AnimatePresence>
          {showChat && (
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="absolute inset-0 z-40 bg-black/60 flex flex-col pt-24"
            >
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {liveChat.map((msg, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-pink-400 font-bold text-sm">@{msg.user}:</span>
                    <span className="text-white text-sm">{msg.message}</span>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex gap-2">
                <Input 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Di algo..."
                  className="bg-zinc-800 border-zinc-700 text-white"
                  onKeyPress={(e) => e.key === 'Enter' && handleSendChat()}
                />
                <Button onClick={handleSendChat} className="bg-pink-500">
                  <Play className="w-4 h-4 rotate-[-90deg]" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Right Controls (TikTok Style) */}
        {liveStream && (
          <div className="absolute right-4 top-24 flex flex-col gap-6 z-30">
            <button className="flex flex-col items-center gap-1 group" onClick={toggleMute}>
              <div className={`p-3 backdrop-blur-md rounded-full transition-colors ${isMuted ? 'bg-red-500' : 'bg-black/40 group-hover:bg-black/60'}`}>
                {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
              </div>
              <span className="text-[10px] text-white font-bold drop-shadow-md">{isMuted ? 'Silenciado' : 'Mic On'}</span>
            </button>
            <button className="flex flex-col items-center gap-1 group" onClick={() => setShowChat(!showChat)}>
              <div className={`p-3 backdrop-blur-md rounded-full transition-colors ${showChat ? 'bg-pink-500' : 'bg-black/40 group-hover:bg-black/60'}`}>
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <span className="text-[10px] text-white font-bold drop-shadow-md">Chat</span>
            </button>
            <button className="flex flex-col items-center gap-1 group" onClick={() => toast.info('Filtros próximamente')}>
              <div className="p-3 bg-black/40 backdrop-blur-md rounded-full group-hover:bg-black/60 transition-colors">
                <Filter className="w-6 h-6 text-white" />
              </div>
              <span className="text-[10px] text-white font-bold drop-shadow-md">Filtros</span>
            </button>
            <button className="flex flex-col items-center gap-1 group" onClick={() => toast.info('Efectos próximamente')}>
              <div className="p-3 bg-black/40 backdrop-blur-md rounded-full group-hover:bg-black/60 transition-colors">
                <Wand2 className="w-6 h-6 text-white" />
              </div>
              <span className="text-[10px] text-white font-bold drop-shadow-md">Efectos</span>
            </button>
            <button className="flex flex-col items-center gap-1 group" onClick={() => toast.info('Pantalla verde próximamente')}>
              <div className="p-3 bg-black/40 backdrop-blur-md rounded-full group-hover:bg-black/60 transition-colors">
                <Monitor className="w-6 h-6 text-green-400" />
              </div>
              <span className="text-[10px] text-white font-bold drop-shadow-md">Fondo</span>
            </button>
          </div>
        )}

        {/* Bottom Banner */}
        <div className="absolute bottom-32 left-4 right-4 z-30">
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-pink-500 rounded-full flex items-center justify-center p-0.5">
                <img src={currentUser?.avatar} alt="Me" className="w-full h-full rounded-full object-cover" />
              </div>
              <div>
                <p className="text-white text-sm font-bold">{isLive ? 'EN DIRECTO' : 'Configuración de Live'}</p>
                <p className="text-zinc-400 text-xs text-green-400">
                  {isLive ? `${formatNumber(viewerCount)} espectadores` : 'P2P Network: Online'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-white text-[10px] font-bold">HD</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-8 bg-black z-30">
        <Button
          className={`w-full h-14 text-white text-lg font-bold rounded-full shadow-lg flex items-center justify-center gap-2 ${isLive ? 'bg-red-600 shadow-red-500/20' : 'bg-[#FE2C55] shadow-[#FE2C55]/20'}`}
          onClick={handleGoLive}
        >
          {isLive ? (
            <>
              <div className="w-3 h-3 bg-white rounded-full" />
              DETENER TRANSMISIÓN
            </>
          ) : (
            <>
              <div className="w-3 h-3 bg-white rounded-full animate-ping" />
              GO LIVE
            </>
          )}
        </Button>
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
