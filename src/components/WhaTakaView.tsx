import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Phone, Video, MoreVertical,
  Send, Mic, MicOff, Smile, CheckCheck,
  Search, Paperclip, Camera, MessageCircle, X,
  Activity, Globe, Cpu, Users, Plus, Shield, TrendingUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/hooks/useSecurity';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { miningService } from '@/services/MiningService';

const WTEmblem = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const dimensions = size === "sm" ? "w-6 h-6 text-[8px]" : size === "lg" ? "w-16 h-16 text-xl" : "w-10 h-10 text-sm";
  return (
    <div className={`${dimensions} bg-gradient-to-br from-purple-900 via-black to-zinc-900 border-2 border-yellow-500 rounded-full flex items-center justify-center font-black text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)] tracking-tighter`}>
      WT
    </div>
  );
};

const MangoLogo = () => (
  <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-purple-400 rounded-2xl rotate-45 flex items-center justify-center shadow-lg border border-purple-300/20 overflow-hidden relative">
    <div className="absolute top-0 right-0 w-4 h-4 bg-green-500 rounded-full -translate-y-1 translate-x-1" />
    <span className="-rotate-45 text-white font-black text-xs">WT</span>
  </div>
);

export const WhaTakaView = () => {
  const { chats, messages, activeChat, setActiveChat, addMessage, currentUser, setCurrentTab } = useStore();
  const { sanitize, checkRateLimit } = useSecurity();
  const [activeTab, setActiveTab] = useState<'chats' | 'nodes' | 'communities' | 'calls'>('chats');
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mining Stats
  const [miningStats, setMiningStats] = useState({
    relayUnits: 0,
    storeUnits: 0,
    uptimeUnits: 0,
    callUnits: 0,
    totalScore: 0
  });

  useEffect(() => {
    const tracker = miningService.getTracker();
    if (!tracker) return;

    // Set Malayaso Fee Mode as per policy
    (tracker as any).setFeeRecipient?.('malayaso');

    const interval = setInterval(() => {
       const t = tracker as any;
       setMiningStats({
         relayUnits: t.relayUnits || 0,
         storeUnits: t.storeUnits || 0,
         uptimeUnits: t.uptimeUnits || 0,
         callUnits: t.callUnits || 0,
         totalScore: t.calculateScore ? t.calculateScore() : 0
       });
    }, 2000);

    return () => {
      clearInterval(interval);
      (tracker as any).setFeeRecipient?.(null);
    };
  }, []);

  // Camera/Mic State & Cleanup
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeChatData = useMemo(() => chats.find(c => c.id === activeChat), [chats, activeChat]);
  const chatMessages = useMemo(() => activeChat ? messages[activeChat] || [] : [], [activeChat, messages]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => () => cameraStream?.getTracks().forEach(t => t.stop()), [cameraStream]);

  // === CAMERA & MIC FUNCTIONS ===
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      setCameraStream(stream); setShowCamera(true); setCapturedPhoto(null);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 100);
    } catch (err) { toast.error('Cámara no disponible.'); }
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
    if (!capturedPhoto || !activeChat) return;
    miningService.getTracker()?.addCallUnits(2);
    addMessage(activeChat, {
      id: Date.now().toString(), senderId: currentUser?.id || 'me', receiverId: activeChatData?.userId || '',
      content: '📷 Foto enviada', type: 'text', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isRead: false
    });
    closeCamera(); toast.success('Foto enviada');
  }, [capturedPhoto, activeChat, currentUser, activeChatData, addMessage, closeCamera]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (chunks.length > 0 && activeChat) {
          miningService.getTracker()?.addCallUnits(3);
          addMessage(activeChat, {
            id: Date.now().toString(), senderId: currentUser?.id || 'me', receiverId: activeChatData?.userId || '',
            content: `🎤 Nota de voz (${recordingTime}s)`, type: 'text', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isRead: false
          });
        }
        setRecordingTime(0);
      };
      mediaRecorder.start(); setIsRecording(true);
      recordingIntervalRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch (err) { toast.error('Micrófono no disponible.'); }
  }, [activeChat, currentUser, activeChatData, addMessage, recordingTime]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
    setIsRecording(false);
  }, []);

  const handleSendMessage = () => {
    if (!messageText.trim() || !activeChat) return;
    if (!checkRateLimit('send_message', 30, 60000)) { toast.error('Límite alcanzado.'); return; }
    miningService.getTracker()?.addCallUnits(1);
    addMessage(activeChat, {
      id: Date.now().toString(), senderId: currentUser?.id || 'me', receiverId: activeChatData?.userId || '',
      content: sanitize(messageText), type: 'text', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isRead: false
    });
    setMessageText('');
  };

  if (!activeChat) {
    return (
      <div className="flex flex-col h-screen bg-[#050505] text-white">
        <header className="bg-zinc-950/90 backdrop-blur-xl pt-4 px-4 pb-0 border-b border-zinc-900/50 sticky top-0 z-50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
               <button onClick={() => setCurrentTab('discover')} className="p-1.5 hover:bg-white/5 rounded-full" title="Volver"><ArrowLeft className="w-5 h-5 text-white" /></button>
               <MangoLogo />
               <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600 tracking-tighter">WhaTaka</h1>
            </div>
            <div className="flex items-center gap-4 text-zinc-400">
              <Search className="w-5 h-5 cursor-pointer hover:text-yellow-500" />
              <MoreVertical className="w-5 h-5 cursor-pointer hover:text-yellow-500" />
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <button onClick={() => setActiveTab('communities')} className={`flex-1 pb-3 flex justify-center transition-all ${activeTab === 'communities' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`}><Users className="w-5 h-5" /></button>
            <button onClick={() => setActiveTab('chats')} className={`flex-[2] pb-3 flex justify-center items-center gap-2 transition-all ${activeTab === 'chats' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`}>Chats <span className="bg-yellow-500 text-black text-[9px] px-2 rounded-full font-black">{chats.length}</span></button>
            <button onClick={() => setActiveTab('nodes')} className={`flex-[2] pb-3 flex justify-center items-center gap-2 transition-all ${activeTab === 'nodes' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`}>Status <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_5px_#22c55e]" /></button>
            <button onClick={() => setActiveTab('calls')} className={`flex-[2] pb-3 flex justify-center transition-all ${activeTab === 'calls' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'hover:text-zinc-300'}`}>Llamadas</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#0a0a0a] pb-24 scrollbar-hide relative">
          <AnimatePresence mode="wait">
            {activeTab === 'nodes' ? (
              <motion.div key="nodes" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="p-4 space-y-4">
                 <div className="bg-gradient-to-br from-zinc-900 to-black rounded-[40px] p-6 border-b-4 border-yellow-500/30 relative overflow-hidden group border border-white/5">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 rounded-full blur-[60px]" />
                    <div className="flex items-center justify-between mb-8">
                       <div className="flex items-center gap-4">
                          <div className="w-14 h-14 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/20">
                             <Activity className="w-7 h-7 text-black" />
                          </div>
                          <div>
                             <h2 className="text-xl font-black text-white uppercase tracking-tighter">Estado del Nodo P2P</h2>
                             <div className="flex items-center gap-1.5">
                               <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
                               <p className="text-[10px] text-green-500 font-black uppercase tracking-[0.2em]">Reportando al Malayaso</p>
                             </div>
                          </div>
                       </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 mb-6">
                       {[
                         { label: 'Relay Units', val: miningStats.relayUnits, col: 'text-blue-400' },
                         { label: 'Minutos Activo', val: miningStats.uptimeUnits, col: 'text-green-400' },
                         { label: 'Chat/Calls', val: miningStats.callUnits, col: 'text-yellow-400' },
                         { label: 'Conexiones', val: '24', col: 'text-purple-400' }
                       ].map(s => (
                         <div key={s.label} className="bg-white/5 p-4 rounded-3xl border border-white/5 shadow-inner">
                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">{s.label}</p>
                            <p className={`text-2xl font-black ${s.col}`}>{s.val}</p>
                         </div>
                       ))}
                    </div>

                    <div className="p-6 bg-yellow-500/10 rounded-[32px] border border-yellow-500/30 flex items-center justify-between shadow-[0_0_20px_rgba(234,179,8,0.1)]">
                       <div>
                          <p className="text-[10px] font-black text-yellow-500/70 uppercase tracking-[0.3em] mb-1 leading-none">Aporte Mensualidad (Malayaso)</p>
                          <p className="text-5xl font-black text-yellow-500 tracking-tighter">{miningStats.totalScore}</p>
                       </div>
                       <WTEmblem size="lg" />
                    </div>
                 </div>
                 
                 <div className="bg-zinc-900/40 p-5 rounded-3xl border border-white/5 flex items-center gap-4">
                    <Shield className="w-8 h-8 text-yellow-500/50" />
                    <p className="text-[11px] font-bold text-zinc-400 leading-relaxed italic">
                      "Toda la minería generada en el módulo WhaTaka se acredita como aporte directo a la billetera administrativa para el mantenimiento de la red."
                    </p>
                 </div>
              </motion.div>
            ) : (
              <motion.div key="chats" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="p-1">
                {chats.map((chat) => (
                  <button key={chat.id} onClick={() => setActiveChat(chat.id)} className="w-full p-4 flex items-center gap-4 hover:bg-zinc-900/50 transition-all border-b border-zinc-900/30 group">
                    <div className="relative">
                      <img src={chat.avatar} alt={chat.username} className="w-14 h-14 rounded-3xl object-cover border border-zinc-800 group-hover:scale-105 transition-transform duration-300" />
                      <div className="absolute -bottom-1 -right-1 scale-90"><WTEmblem size="sm" /></div>
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex justify-between items-center mb-1"><h3 className="text-white font-bold text-[15px]">{chat.username}</h3><span className="text-zinc-500 text-[10px] font-black">{chat.lastMessageTime}</span></div>
                      <p className="text-zinc-500 text-xs truncate max-w-[200px]">{chat.lastMessage}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <button className="fixed bottom-24 right-6 w-14 h-14 bg-gradient-to-br from-yellow-500 via-yellow-400 to-yellow-600 rounded-[22px] shadow-lg flex items-center justify-center text-black z-40"><Plus className="w-8 h-8 font-black" /></button>
        <div className="bg-zinc-950/95 backdrop-blur-md px-6 py-4 border-t border-zinc-900 flex justify-between items-center text-[9px] font-black text-zinc-500 tracking-widest fixed bottom-0 w-full z-50">
           <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_5px_#22c55e]" /><span className="uppercase">AES-256 Cloud Secure</span></div>
           <div className="flex gap-6 uppercase font-black"><span>Malayaso Network</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black relative">
      {showCamera && (
        <div className="absolute inset-0 bg-black z-[100] flex flex-col">
          <div className="bg-zinc-950 p-4 flex items-center justify-between border-b border-white/5"><button onClick={closeCamera} className="p-2"><X className="w-6 h-6 text-white" /></button><span className="text-yellow-500 font-black text-[10px] uppercase tracking-[0.3em]">WT Cam Pro</span><div className="w-10" /></div>
          <div className="flex-1 flex items-center justify-center bg-black">{!capturedPhoto ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" /> : <img src={capturedPhoto} alt="Captura" className="w-full h-full object-cover" />}<canvas ref={canvasRef} className="hidden" /></div>
          <div className="bg-zinc-950 p-10 flex items-center justify-center gap-8 border-t border-white/5">
            {!capturedPhoto ? <button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-yellow-500 bg-yellow-500/10 flex items-center justify-center"><div className="w-16 h-16 rounded-full bg-white" /></button> : <div className="flex gap-4"><button onClick={() => { setCapturedPhoto(null); openCamera(); }} className="px-8 py-4 rounded-3xl bg-zinc-800 text-white font-black text-xs uppercase tracking-widest">Repetir</button><button onClick={sendPhoto} className="px-10 py-4 rounded-3xl bg-yellow-500 text-black font-black text-xs uppercase shadow-xl shadow-yellow-500/20">Enviar</button></div>}
          </div>
        </div>
      )}

      <header className="bg-zinc-950/90 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b border-white/5 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveChat(null)} className="p-2"><ArrowLeft className="w-5 h-5 text-white" /></button>
          <div className="relative"><img src={activeChatData?.avatar} className="w-11 h-11 rounded-2xl object-cover border border-white/10" alt="Av" /><div className="absolute -bottom-1 -right-1 scale-75 rotate-12"><WTEmblem size="sm" /></div></div>
          <div><h3 className="text-white font-black text-sm tracking-tight mb-1">{activeChatData?.username}</h3><div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /><p className="text-green-500 text-[8px] font-black uppercase tracking-[0.2em]">En Línea</p></div></div>
        </div>
        <div className="flex gap-5 text-zinc-400">
          <button title="Videollamada"><Video className="w-5 h-5" /></button>
          <button title="Llamada"><Phone className="w-5 h-5" /></button>
          <button title="Más"><MoreVertical className="w-5 h-5" /></button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black relative hide-scrollbar">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none p-10 grid grid-cols-4 gap-12 rotate-45 select-none">{Array.from({length: 12}).map((_, i) => <MangoLogo key={i} />)}</div>
        <div className="relative z-10 flex flex-col gap-4">
          {chatMessages.map((msg) => {
            const isMe = msg.senderId === currentUser?.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-3xl shadow-2xl relative ${isMe ? 'bg-gradient-to-br from-purple-800 via-purple-900 to-black text-white rounded-tr-none border border-purple-500/20' : 'bg-zinc-900/40 backdrop-blur-md text-white rounded-tl-none border border-white/5'}`}>
                   <p className="text-[13px] leading-relaxed font-medium">{msg.content}</p>
                   <div className="flex justify-end items-center gap-2 mt-2"><span className="text-[9px] text-white/30 font-black tracking-widest uppercase">{msg.timestamp}</span>{isMe && <CheckCheck className="w-3.5 h-3.5 text-yellow-500" />}</div>
                   <div className={`absolute top-0 w-2 h-2 ${isMe ? '-right-1 bg-purple-800 rounded-full' : '-left-1 bg-zinc-800/40 rounded-full'}`} />
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
           <button onClick={stopRecording} className="px-6 py-2.5 bg-white text-black font-black rounded-full text-[10px] uppercase shadow-lg">Detener</button>
        </div>
      )}

      <footer className="p-3 pb-8 bg-zinc-950/80 backdrop-blur-xl border-t border-white/5">
         <div className="flex items-center gap-2">
            <div className="flex-1 bg-white/5 rounded-[28px] px-4 py-2 flex items-center gap-3 border border-white/10 shadow-inner group transition-all focus-within:border-yellow-500/30">
               <Smile className="w-6 h-6 text-yellow-500 cursor-pointer" /><Input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Mensaje..." className="bg-transparent border-none text-white focus-visible:ring-0 p-0 h-11 text-sm font-medium" onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()} />
               <button onClick={openCamera}><Camera className="w-5 h-5 text-zinc-400" /></button><Paperclip className="w-5 h-5 text-zinc-500 rotate-45" />
            </div>
            <button onClick={messageText.trim() ? handleSendMessage : (isRecording ? stopRecording : startRecording)} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all border shrink-0 ${isRecording ? 'bg-red-600 border-white/20 animate-pulse' : messageText.trim() ? 'bg-yellow-500 border-yellow-400 text-black active:scale-90' : 'bg-zinc-800 border-white/5 text-zinc-400'}`}>
               {messageText.trim() ? <Send className="w-6 h-6" /> : isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
         </div>
      </footer>
    </div>
  );
};
