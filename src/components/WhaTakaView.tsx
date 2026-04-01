import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Phone, Video, MoreVertical,
  Send, Mic, MicOff, Smile, CheckCheck,
  Search, Paperclip, Camera, X,
  Globe, Cpu, Users, Plus, Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/hooks/useSecurity';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { miningService } from '@/services/MiningService';
import { chatApi, messageApi } from '@/services/api';
import { io, Socket } from 'socket.io-client';

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && window.location.hostname.includes('github.io')) {
    return 'https://taktak-app.onrender.com';
  }
  return '';
};

const MangoHaloLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const dim = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-32 h-32" : "w-16 h-16";
  return (
    <div className={`relative ${dim} flex items-center justify-center`}>
      <div className="absolute inset-x-0 -top-2 h-4 bg-yellow-400/30 blur-md rounded-full border border-yellow-200/50 scale-x-110" />
      <div className="absolute inset-x-0 -top-2 h-2 bg-yellow-200/50 blur-[2px] rounded-full scale-x-105" />
      <div className="w-full h-full bg-gradient-to-br from-purple-500 via-purple-700 to-purple-900 rounded-[40%_60%_60%_40%/50%_40%_60%_50%] relative overflow-hidden shadow-[0_10px_30px_rgba(168,85,247,0.4)] border border-purple-400/20">
        <div className="absolute top-1 left-2 w-1/3 h-1/4 bg-white/10 rounded-full blur-sm rotate-12" />
        <div className="absolute bottom-2 right-4 w-1/2 h-1/2 bg-black/20 rounded-full blur-md" />
      </div>
      <div className="absolute -top-1 right-2 w-1/3 h-1/3 bg-gradient-to-br from-green-400 to-green-700 rounded-[0%_100%_0%_100%] rotate-45 border border-green-300/30" />
      <div className="absolute -top-1 right-2 w-1/4 h-1 px-1 bg-green-900/40 rounded-full rotate-45" />
      {size === "lg" && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-full h-full bg-yellow-500/5 rounded-full blur-3xl" /></div>}
    </div>
  );
};

const WTEmblem = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const dimensions = size === "sm" ? "w-6 h-6 text-[8px]" : size === "lg" ? "w-16 h-16 text-xl" : "w-10 h-10 text-sm";
  return (
    <div className={`${dimensions} bg-gradient-to-br from-purple-900 via-black to-zinc-900 border border-yellow-500/50 rounded-full flex items-center justify-center font-black text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)] tracking-tighter overflow-hidden`}>
      <MangoHaloLogo size="sm" />
    </div>
  );
};

export const WhaTakaView = () => {
  const { currentUser, setCurrentTab } = useStore();
  const { sanitize, checkRateLimit } = useSecurity();
  const [activeTab, setActiveTab] = useState<'chats' | 'communities' | 'calls' | 'configuration'>('chats');
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Real data state
  const [chats, setChats] = useState<any[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const tracker = miningService.getTracker();
    if (!tracker) return;
    (tracker as any).setFeeRecipient?.('malayaso');
    return () => { (tracker as any).setFeeRecipient?.(null); };
  }, []);

  // Fetch initial chats
  useEffect(() => {
    const fetchChats = async () => {
      try {
        const res = await chatApi.getChats();
        setChats(res.data);
      } catch (err) {
        console.error('Error fetching chats:', err);
      }
    };
    fetchChats();
  }, [activeChatId]);

  // Handle Socket.IO connection
  useEffect(() => {
    const token = localStorage.getItem('taktak_token');
    if (!token) return;

    socketRef.current = io(getBaseUrl(), {
      auth: { token }
    });

    socketRef.current.on('connect', () => {
      console.log('Connected to chat server');
    });

    socketRef.current.on('new_message', (message) => {
      if (message.chatId === activeChatId) {
        setChatMessages(prev => [...prev, message]);
        // Mark as read immediately if chat is active
        socketRef.current?.emit('mark_read', { chatId: activeChatId, messageId: message.id });
      } else {
        // Increment unread count in chats list
        setChats(prev => prev.map(chat => 
          chat._id === message.chatId 
            ? { ...chat, unreadCounts: { ...chat.unreadCounts, [currentUser?.id || '']: (chat.unreadCounts?.[currentUser?.id || ''] || 0) + 1 }, lastMessage: message }
            : chat
        ));
      }
    });

    socketRef.current.on('messages_read', ({ messageId }) => {
      setChatMessages(prev => prev.map(m => m.id === messageId || m._id === messageId ? { ...m, isRead: true } : m));
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [activeChatId, currentUser?.id]);

  // Load messages when chat becomes active
  useEffect(() => {
    if (activeChatId) {
      socketRef.current?.emit('join_chat', activeChatId);
      const fetchHistory = async () => {
        try {
          const res = await messageApi.getHistory(activeChatId);
          setChatMessages(res.data);
          // Auto-mark as read
          await messageApi.markAsRead(activeChatId);
        } catch (err) {
          console.error('Error fetching history:', err);
        }
      };
      fetchHistory();
    }
  }, [activeChatId]);

  const activeChatData = useMemo(() => {
    const chat = chats.find(c => c._id === activeChatId);
    if (!chat) return null;
    const partner = chat.participants.find((p: any) => p._id !== currentUser?.id);
    return {
      userId: partner?._id,
      username: partner?.username || 'Unknown',
      avatar: partner?.avatar || 'https://via.placeholder.com/150',
    };
  }, [chats, activeChatId, currentUser]);

  const addLocalMessage = (content: string, type = 'text') => {
    if (!activeChatId || !currentUser) return;
    const tempMsg = {
      _id: Date.now().toString(),
      chatId: activeChatId,
      senderId: currentUser.id,
      content,
      type,
      isRead: false,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date()
    };
    setChatMessages(prev => [...prev, tempMsg]);
    socketRef.current?.emit('send_message', {
      chatId: activeChatId,
      content,
      type
    });
  };

  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => () => cameraStream?.getTracks().forEach(t => t.stop()), [cameraStream]);

  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      setCameraStream(stream); setShowCamera(true); setCapturedPhoto(null);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 100);
    } catch (err) { console.error(err); toast.error('Cámara no disponible.'); }
  }, []);

  const closeCamera = useCallback(() => {
    cameraStream?.getTracks().forEach(track => track.stop());
    setCameraStream(null); setShowCamera(false); setCapturedPhoto(null);
  }, [cameraStream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.8));
    cameraStream?.getTracks().forEach(track => track.stop());
  }, [cameraStream]);

  const sendPhoto = useCallback(() => {
    if (!capturedPhoto || !activeChatId) return;
    miningService.getTracker()?.addCallUnits(2);
    addLocalMessage('📷 Foto enviada', 'image');
    closeCamera(); toast.success('Foto enviada');
  }, [capturedPhoto, activeChatId, currentUser, activeChatData, closeCamera]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (chunks.length > 0 && activeChatId) {
          miningService.getTracker()?.addCallUnits(3);
          addLocalMessage(`🎤 Nota de voz (${recordingTime}s)`, 'audio');
        }
        setRecordingTime(0);
      };
      mediaRecorder.start(); setIsRecording(true);
      recordingIntervalRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch (err) { console.error(err); toast.error('Micrófono no disponible.'); }
  }, [activeChatId, currentUser, activeChatData, recordingTime]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
    setIsRecording(false);
  }, []);

  const handleSendMessage = () => {
    if (!messageText.trim() || !activeChatId) return;
    if (!checkRateLimit('send_message', 30, 60000)) { toast.error('Límite alcanzado.'); return; }
    miningService.getTracker()?.addCallUnits(1);
    addLocalMessage(sanitize(messageText), 'text');
    setMessageText('');
  };

  const startNewChat = async (participantId: string) => {
    try {
      const res = await chatApi.createChat(participantId);
      setChats(prev => {
        const exists = prev.find(c => c._id === res.data._id);
        if (exists) return prev;
        return [res.data, ...prev];
      });
      setActiveChatId(res.data._id);
    } catch (err) {
      toast.error('Error al iniciar chat');
    }
  };

  if (!activeChatId) {
    return (
      <div className="flex flex-col h-screen bg-[#050505] text-white">
        <header className="bg-zinc-950/90 backdrop-blur-xl pt-4 px-4 pb-0 border-b border-zinc-900/50 sticky top-0 z-50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
               <button onClick={() => setCurrentTab('discover')} className="p-1.5 hover:bg-white/5 rounded-full" title="Volver"><ArrowLeft className="w-5 h-5 text-white" /></button>
               <MangoHaloLogo size="sm" />
               <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600 tracking-tighter">WhaTaka</h1>
            </div>
            <div className="flex items-center gap-4 text-zinc-400">
              <button title="Buscar"><Search className="w-5 h-5 cursor-pointer hover:text-yellow-500" /></button>
              <button title="Más opciones"><MoreVertical className="w-5 h-5 cursor-pointer hover:text-yellow-500" /></button>
            </div>
          </div>
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <button onClick={() => setActiveTab('communities')} className={`flex-1 pb-3 flex justify-center transition-all ${activeTab === 'communities' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`} title="Comunidades"><Users className="w-5 h-5" /></button>
            <button onClick={() => setActiveTab('chats')} className={`flex-[2] pb-3 flex justify-center items-center gap-2 transition-all ${activeTab === 'chats' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`} title="Chats">Chats <span className="bg-yellow-500 text-black text-[9px] px-2 rounded-full font-black">{chats.length}</span></button>
            <button onClick={() => setActiveTab('calls')} className={`flex-[2] pb-3 flex justify-center transition-all ${activeTab === 'calls' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`} title="Llamadas">Llamadas</button>
            <button onClick={() => setActiveTab('configuration')} className={`flex-1 pb-3 flex justify-center transition-all ${activeTab === 'configuration' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`} title="Configuración">Config</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#0a0a0a] pb-24 relative">
          <AnimatePresence mode="wait">
            {activeTab === 'communities' ? (
              <motion.div key="communities" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4">
                 <div className="text-center py-20 text-zinc-600">Comunidades próximamente</div>
              </motion.div>
            ) : activeTab === 'configuration' ? (
              <motion.div key="config" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-6 flex flex-col items-center">
                 <div className="mb-8 flex flex-col items-center"><MangoHaloLogo size="lg" /><h2 className="text-2xl font-serif text-yellow-500 mt-4 tracking-wider italic">Configuration</h2></div>
                 <div className="w-full space-y-4 mb-24">
                    {[{ icon: Shield, title: 'Account & Security', desc: 'Manage your login details' }, { icon: Globe, title: 'Privacy', desc: 'Manage your privacy' }, { icon: Users, title: 'Profile', desc: "Manage your profile" }, { icon: Mic, title: 'Notifications', desc: 'Manage notifications' }, { icon: Smile, title: 'Appearance', desc: 'Themes and colors' }, { icon: Cpu, title: 'Device & Data', desc: 'Storage and data' }, { icon: Search, title: 'About WhaTaka', desc: 'Information' }].map((item, i) => (
                      <button key={i} className="w-full p-4 bg-gradient-to-r from-zinc-900/80 to-purple-900/10 border border-yellow-500/20 rounded-2xl flex items-center gap-4 hover:border-yellow-500/40 transition-all group" title={item.title}>
                         <div className="w-10 h-10 bg-black/40 border border-yellow-500/30 rounded-xl flex items-center justify-center group-hover:bg-yellow-500/10"><item.icon className="w-5 h-5 text-yellow-500" /></div>
                         <div className="text-left"><h3 className="text-yellow-500 font-bold text-sm tracking-wide">{item.title}</h3><p className="text-zinc-500 text-[10px] leading-tight mt-0.5">{item.desc}</p></div>
                      </button>
                    ))}
                 </div>
              </motion.div>
            ) : activeTab === 'calls' ? (
              <motion.div key="calls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-2 space-y-1">
                 <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] ml-4 mb-4">Llamadas Recientes</h2>
                 {chats.map((chat) => (
                    <div key={chat._id} className="p-4 flex items-center gap-4 hover:bg-zinc-900/40 transition-all rounded-3xl group">
                       <div className="relative">
                         <img src={chat.participants.find((p:any) => p._id !== currentUser?.id)?.avatar || 'https://via.placeholder.com/150'} className="w-14 h-14 rounded-full object-cover border-2 border-yellow-500/20" alt="Av" />
                         <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-full flex items-center justify-center border border-black" title="Phone"><Phone className="w-3 h-3 text-black" /></div>
                       </div>
                       <div className="flex-1"><div className="flex justify-between items-center"><h3 className="text-white font-bold">{chat.participants.find((p:any) => p._id !== currentUser?.id)?.username}</h3><span className="text-zinc-500 text-[10px]">Just now</span></div><div className="flex items-center gap-1.5 text-zinc-500 text-[11px]"><Phone className="w-3.5 h-3.5 text-yellow-500" /> <span>¡Qué tal chamo!</span></div></div>
                       <button className="w-12 h-12 bg-yellow-500/10 rounded-2xl flex items-center justify-center border border-yellow-500/20 group-hover:bg-yellow-500/20" title="Videochat"><Video className="w-5 h-5 text-yellow-500" /></button>
                    </div>
                 ))}
              </motion.div>
            ) : (
              <motion.div key="chats" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="p-1">
                {chats.length === 0 && (
                  <div className="text-center py-20 text-zinc-600 text-sm">No tienes chats activos aún.<br/>Busca usuarios para iniciar una conversación.</div>
                )}
                {chats.map((chat) => {
                  const partner = chat.participants.find((p: any) => p._id !== currentUser?.id);
                  const lastMessageContent = chat.lastMessage?.content || 'Inicia la conversación';
                  const unread = chat.unreadCounts?.[currentUser?.id || ''] || 0;
                  
                  return (
                    <button key={chat._id} onClick={() => setActiveChatId(chat._id)} className="w-full p-4 flex items-center gap-4 hover:bg-zinc-900/50 transition-all border-b border-zinc-900/30 group">
                      <div className="relative">
                        <img src={partner?.avatar || 'https://via.placeholder.com/150'} alt={partner?.username} className="w-14 h-14 rounded-[40%] object-cover border border-yellow-500/20 shadow-lg group-hover:rotate-6 transition-all" />
                        <div className="absolute -bottom-1 -right-1"><MangoHaloLogo size="sm" /></div>
                        {unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex flex-col items-center justify-center rounded-full font-bold shadow-sm">{unread}</span>}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex justify-between items-center mb-1">
                          <h3 className="text-white font-black text-[15px] tracking-tight">{partner?.username}</h3>
                          <span className="text-zinc-500 text-[10px] font-black uppercase text-right">
                            {chat.lastMessageAt ? new Date(chat.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className={`text-xs truncate max-w-[200px] ${unread > 0 ? 'text-white font-bold' : 'text-zinc-500'}`}>{lastMessageContent}</p>
                          {chat.lastMessage?.senderId === currentUser?.id && (
                            <div className="w-4 h-4 bg-yellow-500/10 border border-yellow-500/30 rounded-full flex items-center justify-center">
                              <div className={`w-1.5 h-1.5 rounded-full ${chat.lastMessage?.isRead ? 'bg-yellow-500' : 'bg-zinc-500'}`} />
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        <button 
          className="fixed bottom-24 right-6 w-14 h-14 bg-gradient-to-br from-yellow-500 via-yellow-400 to-yellow-600 rounded-[22px] shadow-lg flex items-center justify-center text-black z-40 hover:scale-105 transition-transform" 
          title="Nuevo Chat"
          onClick={() => {
            const username = prompt('Ingresa el nombre de usuario para chatear:');
            if (username) {
              // Real implementation should search user by ID or username from backend
              toast.info(`Buscando a ${username}...`);
            }
          }}
        >
          <Plus className="w-8 h-8 font-black" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black relative">
       {showCamera && (
        <div className="absolute inset-0 bg-black z-[100] flex flex-col">
          <div className="bg-zinc-950 p-4 flex items-center justify-between border-b border-white/5"><button onClick={closeCamera} className="p-2" title="Cerrar"><X className="w-6 h-6 text-white" /></button><span className="text-yellow-500 font-black text-[10px] uppercase tracking-[0.3em]">WT Cam Pro</span><div className="w-10" /></div>
          <div className="flex-1 flex items-center justify-center bg-black">{!capturedPhoto ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" /> : <img src={capturedPhoto} alt="Captura" className="w-full h-full object-cover" />}<canvas ref={canvasRef} className="hidden" /></div>
          <div className="bg-zinc-950 p-10 flex items-center justify-center gap-8 border-t border-white/5">
            {!capturedPhoto ? <button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-yellow-500 bg-yellow-500/10 flex items-center justify-center" title="Capturar"><div className="w-16 h-16 rounded-full bg-white" /></button> : <div className="flex gap-4"><button onClick={() => { setCapturedPhoto(null); openCamera(); }} className="px-8 py-4 rounded-3xl bg-zinc-800 text-white font-black text-xs uppercase" title="Reintentar">Repetir</button><button onClick={sendPhoto} className="px-10 py-4 rounded-3xl bg-yellow-500 text-black font-black text-xs uppercase shadow-xl shadow-yellow-500/20" title="Enviar">Enviar</button></div>}
          </div>
        </div>
      )}
      <header className="bg-zinc-950/90 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b border-white/5 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => {
            setActiveChatId(null);
            socketRef.current?.emit('leave_chat', activeChatId);
          }} className="p-2" title="Volver"><ArrowLeft className="w-5 h-5 text-white" /></button>
          <div className="relative"><img src={activeChatData?.avatar} className="w-11 h-11 rounded-2xl object-cover border border-white/10" alt="Av" /><div className="absolute -bottom-1 -right-1 scale-75 rotate-12"><WTEmblem size="sm" /></div></div>
          <div><h3 className="text-white font-black text-sm tracking-tight mb-1">{activeChatData?.username}</h3><div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /><p className="text-green-500 text-[8px] font-black uppercase tracking-[0.2em]">En Línea</p></div></div>
        </div>
        <div className="flex gap-5 text-zinc-400">
          <button title="Videollamada"><Video className="w-5 h-5" /></button>
          <button title="Llamada"><Phone className="w-5 h-5" /></button>
          <button title="Más"><MoreVertical className="w-5 h-5" /></button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black relative">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none p-10 grid grid-cols-4 gap-12 rotate-45 select-none">{Array.from({length: 12}).map((_, i) => <MangoHaloLogo key={i} size="sm" />)}</div>
        <div className="relative z-10 flex flex-col gap-4">
          {chatMessages.map((msg) => {
            const isMe = msg.senderId === currentUser?.id;
            return (
              <div key={msg._id || msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-3xl shadow-xl relative ${isMe ? 'bg-gradient-to-br from-purple-800 via-zinc-900 to-black text-white rounded-tr-none border border-yellow-500/20' : 'bg-black/60 backdrop-blur-md text-white rounded-tl-none border border-purple-900/50'}`}>
                   <p className="text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">{isMe ? 'Yo' : activeChatData?.username}</p>
                   <p className="text-[14px] leading-relaxed font-medium">{msg.content}</p>
                   <div className="flex justify-end items-center gap-1.5 mt-2">
                     <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
                       {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'}) : msg.timestamp}
                     </span>
                     {isMe && <CheckCheck className={`w-4 h-4 ${msg.isRead ? 'text-yellow-500' : 'text-zinc-600'}`} />}
                   </div>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={messagesEndRef} />
      </div>
      {isRecording && (
        <div className="absolute bottom-24 left-4 right-4 bg-gradient-to-r from-red-600 to-black p-4 flex items-center justify-between z-[60] border border-red-500/30 rounded-3xl backdrop-blur-2xl shadow-2xl animate-in fade-in duration-300">
           <div className="flex items-center gap-4"><div className="w-3 h-3 bg-white rounded-full animate-ping" /><span className="text-white font-black text-xl">{recordingTime}s</span><span className="text-white/50 text-[9px] font-black uppercase">Grabando Nota P2P...</span></div>
           <button onClick={stopRecording} className="px-6 py-2.5 bg-white text-black font-black rounded-full text-[10px] uppercase shadow-lg" title="Detener">Detener</button>
        </div>
      )}
      <footer className="p-3 pb-8 bg-zinc-950/80 backdrop-blur-xl border-t border-white/5">
         <div className="flex items-center gap-2">
            <div className="flex-1 bg-white/5 rounded-[28px] px-4 py-2 flex items-center gap-3 border border-white/10 shadow-inner group transition-all focus-within:border-yellow-500/30">
               <button title="Emojis"><Smile className="w-6 h-6 text-yellow-500 cursor-pointer" /></button>
               <Input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Mensaje..." className="bg-transparent border-none text-white focus-visible:ring-0 p-0 h-11 text-sm font-medium" onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()} />
               <button onClick={openCamera} title="Foto"><Camera className="w-5 h-5 text-zinc-400" /></button>
               <button title="Archivo"><Paperclip className="w-5 h-5 text-zinc-500 rotate-45" /></button>
            </div>
            <button onClick={messageText.trim() ? handleSendMessage : (isRecording ? stopRecording : startRecording)} title={messageText.trim() ? "Enviar" : isRecording ? "Detener" : "Micrófono"} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all border shrink-0 ${isRecording ? 'bg-red-600 border-white/20 animate-pulse' : messageText.trim() ? 'bg-yellow-500 border-yellow-400 text-black active:scale-90' : 'bg-zinc-800 border-white/5 text-zinc-400'}`}>
               {messageText.trim() ? <Send className="w-6 h-6" /> : isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
         </div>
      </footer>
    </div>
  );
};
