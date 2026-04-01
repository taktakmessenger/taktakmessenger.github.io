import React, { useEffect, useState } from 'react';
import axios from 'axios';
import VideoPlayer from './VideoPlayer';

interface VideoData {
  id: number;
  title: string;
  videoUrl: string;
  createdAt: string;
  likes: number;
}

export default function Feed() {
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadFeed() {
    try {
      const res = await axios.get('/api/feed');
      setVideos(res.data.data || []);
    } catch (err) {
      console.error('Error al cargar feed:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeed();
  }, []);

  const handleLike = async (id: number) => {
    const token = localStorage.getItem('taktak_token');
    if (!token) return alert('Inicia sesión para dar like.');

    try {
      await axios.post('/api/interactions/like', 
        { id }, 
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Actualizar likes localmente
      setVideos(prev => prev.map(v => v.id === id ? { ...v, likes: v.likes + 1 } : v));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-4 text-center">Cargando Taktak...</div>;

  return (
    <div className="flex flex-col gap-4">
      {videos.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          Aún no hay vídeos en el feed. ¡Sé el primero en subir uno!
        </div>
      )}
      {videos.map(v => (
        <div key={v.id} className="relative bg-[#111] overflow-hidden rounded-xl shadow-lg">
          <div className="absolute top-4 left-4 z-20 text-white drop-shadow-md">
            <h3 className="font-bold text-lg">{v.title}</h3>
            <span className="text-xs opacity-80">{new Date(v.createdAt).toLocaleString()}</span>
          </div>
          
          <VideoPlayer src={v.videoUrl} />
          
          <div className="p-4 flex items-center justify-between bg-black/40 backdrop-blur-sm">
            <button 
              onClick={() => handleLike(v.id)}
              className="flex items-center gap-2 group"
            >
              <div className="p-2 rounded-full group-hover:bg-red-500/20 transition-colors">
                <span className="text-2xl">❤️</span>
              </div>
              <span className="text-white font-bold">{v.likes}</span>
            </button>
            
            <button className="text-white/60 text-sm hover:text-white transition-colors">
              Compartir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
