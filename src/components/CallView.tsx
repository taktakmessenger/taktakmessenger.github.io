import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, Video, Mic, MicOff, VideoOff, PhoneOff,
  PhoneIncoming, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';

type CallStatus = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';

interface ActiveCall {
  userId: string;
  username: string;
  avatar: string;
  type: 'voice' | 'video';
  status: CallStatus;
  duration: number;
}

export const CallView = () => {
  const { chats } = useStore();
  const [showCallModal, setShowCallModal] = useState(false);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const startCall = (chatId: string, type: 'voice' | 'video') => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    setCallType(type);
    setActiveCall({
      userId: chat.userId,
      username: chat.username,
      avatar: chat.avatar,
      type,
      status: 'calling',
      duration: 0
    });

    // Simulate call connection
    setTimeout(() => {
      setActiveCall(prev => prev ? { ...prev, status: 'ringing' } : null);
    }, 2000);

    setTimeout(() => {
      setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
      // Start duration counter
      const interval = setInterval(() => {
        setActiveCall(prev => {
          if (prev?.status === 'connected') {
            return { ...prev, duration: prev.duration + 1 };
          }
          clearInterval(interval);
          return prev;
        });
      }, 1000);
    }, 4000);
  };

  const endCall = () => {
    if (activeCall) {
      setActiveCall(prev => prev ? { ...prev, status: 'ended' } : null);
      setTimeout(() => setActiveCall(null), 2000);
    }
  };

  if (activeCall) {
    return (
      <CallScreen
        call={activeCall}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        isVideoOff={isVideoOff}
        setIsVideoOff={setIsVideoOff}
        onEndCall={endCall}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#12233e]">
      {/* Header */}
      <div className="bg-[#00a884] px-4 py-3">
        <h1 className="text-black font-medium">Llamadas</h1>
      </div>

      {/* Quick Call Buttons */}
      <div className="p-4 flex gap-3">
        <Button
          onClick={() => setShowCallModal(true)}
          className="flex-1 bg-green-500 hover:bg-green-600"
        >
          <Phone className="w-4 h-4 mr-2" />
          Llamada de voz
        </Button>
        <Button
          onClick={() => setShowCallModal(true)}
          variant="outline"
          className="flex-1 border-green-500 text-green-400"
        >
          <Video className="w-4 h-4 mr-2" />
          Video llamada
        </Button>
      </div>

      {/* Recent Calls */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2">
          <h2 className="text-gray-600 text-sm font-medium mb-3">Recientes</h2>
          
          {chats.slice(0, 5).map((chat) => (
            <div
              key={chat.id}
              className="flex items-center justify-between py-3 border-b border-[#233438]"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img
                    src={chat.avatar}
                    alt={chat.username}
                    className="w-12 h-12 rounded-full"
                  />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#12233e]" />
                </div>
                <div>
                  <p className="text-black font-medium">{chat.username}</p>
                  <div className="flex items-center gap-1 text-zinc-500 text-xs">
                    <PhoneIncoming className="w-3 h-3" />
                    <span>Ayer, 3:45 PM</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startCall(chat.id, 'voice')}
                  className="p-2 bg-green-500 rounded-full hover:bg-green-600"
                >
                  <Phone className="w-4 h-4 text-black" />
                </button>
                <button
                  onClick={() => startCall(chat.id, 'video')}
                  className="p-2 bg-blue-500 rounded-full hover:bg-blue-600"
                >
                  <Video className="w-4 h-4 text-black" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Call History Stats */}
        <div className="p-4 mt-4">
          <div className="bg-[#1f2c34] rounded-xl p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-black text-xl font-bold">127</p>
                <p className="text-zinc-500 text-xs">Llamadas hoy</p>
              </div>
              <div>
                <p className="text-green-400 text-xl font-bold">89%</p>
                <p className="text-zinc-500 text-xs">Exitosas</p>
              </div>
              <div>
                <p className="text-blue-400 text-xl font-bold">4.5 min</p>
                <p className="text-zinc-500 text-xs">Duración prom.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Call Modal */}
      <AnimatePresence>
        {showCallModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-[#1f2c34] rounded-2xl w-full max-w-sm p-6"
            >
              <h2 className="text-black text-xl font-bold mb-4 text-center">
                Nueva Llamada
              </h2>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  placeholder="Buscar contacto..."
                  className="bg-[#2a3942] border-none text-black pl-10"
                />
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => {
                      startCall(chat.id, callType);
                      setShowCallModal(false);
                    }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-[#2a3942] rounded-lg"
                  >
                    <img
                      src={chat.avatar}
                      alt={chat.username}
                      className="w-10 h-10 rounded-full"
                    />
                    <span className="text-black">{chat.username}</span>
                  </button>
                ))}
              </div>

              <Button
                variant="ghost"
                onClick={() => setShowCallModal(false)}
                className="w-full mt-4 text-gray-600"
              >
                Cancelar
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const CallScreen = ({
  call,
  isMuted,
  setIsMuted,
  isVideoOff,
  setIsVideoOff,
  onEndCall
}: {
  call: ActiveCall;
  isMuted: boolean;
  setIsMuted: (v: boolean) => void;
  isVideoOff: boolean;
  setIsVideoOff: (v: boolean) => void;
  onEndCall: () => void;
}) => {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Video or Avatar */}
      <div className="flex-1 flex items-center justify-center">
        {call.type === 'video' && !isVideoOff ? (
          <div className="w-full h-full bg-gradient-to-b from-gray-900 to-black flex items-center justify-center">
            <img
              src={call.avatar}
              alt={call.username}
              className="w-48 h-48 rounded-full"
            />
          </div>
        ) : (
          <div className="text-center">
            <img
              src={call.avatar}
              alt={call.username}
              className="w-32 h-32 rounded-full mx-auto mb-4"
            />
            <p className="text-black text-xl font-bold">{call.username}</p>
            <p className="text-gray-600">
              {call.status === 'calling' && 'Llamando...'}
              {call.status === 'ringing' && 'Sonando...'}
              {call.status === 'connected' && formatDuration(call.duration)}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-[#1f2c34] p-6">
        <div className="flex justify-center gap-4">
          {call.type === 'video' && (
            <button
              onClick={() => setIsVideoOff(!isVideoOff)}
              className={`p-4 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-zinc-700'}`}
            >
              {isVideoOff ? (
                <VideoOff className="w-6 h-6 text-black" />
              ) : (
                <Video className="w-6 h-6 text-black" />
              )}
            </button>
          )}

          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-4 rounded-full ${isMuted ? 'bg-red-500' : 'bg-zinc-700'}`}
          >
            {isMuted ? (
              <MicOff className="w-6 h-6 text-black" />
            ) : (
              <Mic className="w-6 h-6 text-black" />
            )}
          </button>

          <button
            onClick={onEndCall}
            className="p-4 rounded-full bg-red-500"
          >
            <PhoneOff className="w-6 h-6 text-black" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CallView;
