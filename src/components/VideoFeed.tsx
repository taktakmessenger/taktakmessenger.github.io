import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Heart, MessageCircle, Share2, Bookmark, 
  Music2, Volume2, VolumeX, Gift, Plus
} from 'lucide-react';
import { useStore, type Video } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { GiftModal } from './GiftModal';

interface VideoItemProps {
  video: Video;
  isActive: boolean;
}

const VideoItem = ({ video, isActive }: VideoItemProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const { likeVideo, followUser } = useStore();

  useEffect(() => {
    if (videoRef.current) {
      if (isActive) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        setIsPlaying(false);
      }
    }
  }, [isActive]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div className="relative w-full h-screen video-item">
      {/* Video */}
      <video
        ref={videoRef}
        src={video.videoUrl}
        poster={video.thumbnail}
        className="w-full h-full object-cover"
        loop
        muted={isMuted}
        playsInline
        onClick={togglePlay}
      />

      {/* Gradient Overlays */}
      <div className="absolute inset-0 gradient-top pointer-events-none" />
      <div className="absolute inset-0 gradient-bottom pointer-events-none" />

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={toggleMute}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-white/80 text-sm">
          <Music2 className="w-4 h-4" />
          <span className="truncate max-w-[150px]">Canción Original - {video.username}</span>
        </div>
      </div>

      {/* Right Side Actions */}
      <div className="absolute right-4 bottom-24 flex flex-col items-center gap-4 z-10">
        {/* Avatar */}
        <div className="relative">
          <img
            src={video.userAvatar}
            alt={video.username}
            className="w-12 h-12 rounded-full border-2 border-white object-cover"
          />
          {!video.isFollowing && (
            <button
              onClick={() => followUser(video.userId)}
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center hover:bg-purple-600 transition-colors"
            >
              <Plus className="w-4 h-4 text-white" />
            </button>
          )}
        </div>

        {/* Like */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => likeVideo(video.id)}
          className="flex flex-col items-center gap-1"
        >
          <div className={`p-3 rounded-full ${video.isLiked ? 'bg-red-500' : 'bg-black/30 backdrop-blur-sm'}`}>
            <Heart className={`w-7 h-7 ${video.isLiked ? 'text-white fill-white' : 'text-white'}`} />
          </div>
          <span className="text-white text-sm font-medium">{formatNumber(video.likes)}</span>
        </motion.button>

        {/* Comments */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          className="flex flex-col items-center gap-1"
        >
          <div className="p-3 rounded-full bg-black/30 backdrop-blur-sm">
            <MessageCircle className="w-7 h-7 text-white" />
          </div>
          <span className="text-white text-sm font-medium">{formatNumber(video.comments)}</span>
        </motion.button>

        {/* Gifts */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowGiftModal(true)}
          className="flex flex-col items-center gap-1"
        >
          <div className="p-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 glow-effect">
            <Gift className="w-7 h-7 text-white" />
          </div>
          <span className="text-white text-sm font-medium">{formatNumber(video.gifts)}</span>
        </motion.button>

        {/* Share */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          className="flex flex-col items-center gap-1"
        >
          <div className="p-3 rounded-full bg-black/30 backdrop-blur-sm">
            <Share2 className="w-7 h-7 text-white" />
          </div>
          <span className="text-white text-sm font-medium">{formatNumber(video.shares)}</span>
        </motion.button>

        {/* Save */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          className="flex flex-col items-center gap-1"
        >
          <div className="p-3 rounded-full bg-black/30 backdrop-blur-sm">
            <Bookmark className="w-7 h-7 text-white" />
          </div>
        </motion.button>
      </div>

      {/* Bottom Info */}
      <div className="absolute left-4 bottom-24 right-20 z-10">
        <div className="text-white space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg">@{video.username}</span>
            {video.isFollowing && (
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Siguiendo</span>
            )}
          </div>
          <p className="text-sm leading-relaxed max-w-[280px]">{video.caption}</p>
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Music2 className="w-4 h-4" />
            <span className="truncate">Sonido original - {video.username}</span>
          </div>
        </div>
      </div>

      {/* Gift Modal */}
      <AnimatePresence>
        {showGiftModal && (
          <GiftModal 
            videoId={video.id} 
            onClose={() => setShowGiftModal(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export const VideoFeed = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { videos, currentVideoIndex, setCurrentVideoIndex } = useStore();
  const [isScrolling, setIsScrolling] = useState(false);

  const handleScroll = useCallback(() => {
    if (!containerRef.current || isScrolling) return;
    
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const itemHeight = window.innerHeight;
    const newIndex = Math.round(scrollTop / itemHeight);
    
    if (newIndex !== currentVideoIndex && newIndex >= 0 && newIndex < videos.length) {
      setIsScrolling(true);
      setCurrentVideoIndex(newIndex);
      setTimeout(() => setIsScrolling(false), 500);
    }
  }, [currentVideoIndex, videos.length, setCurrentVideoIndex, isScrolling]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-screen overflow-y-scroll hide-scrollbar video-container"
    >
      {videos.map((video, index) => (
        <VideoItem 
          key={video.id} 
          video={video} 
          isActive={index === currentVideoIndex}
        />
      ))}
    </div>
  );
};
