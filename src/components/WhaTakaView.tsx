import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Phone, Video, MoreVertical,
  Send, Mic, MicOff, Smile, CheckCheck,
  Search, Paperclip, Camera, MessageCircle, X
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/hooks/useSecurity';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { miningService } from '@/services/MiningService';

const WTEmblem = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const dimensions = size === "sm" ? "w-6 h-6 text-[8px]" : size === "lg" ? "w-16 h-16 text-xl" : "w-10 h-10 text-sm";
  return (
    <div className={`${dimensions} bg-gradient-to-br from-purple-600 to-black border-2 border-yellow-500 rounded-full flex items-center justify-center font-black text-white shadow-lg`}>
      WT
    </div>
  );
};

export const WhaTakaView = () => {
  const { chats, messages, activeChat, setActiveChat, addMessage, currentUser, setCurrentTab } = useStore();
  const { sanitize, checkRateLimit } = useSecurity();
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Camera State
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mic State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeChatData = useMemo(() => chats.find(c => c.id === activeChat), [chats, activeChat]);
  const chatMessages = useMemo(() => activeChat ? messages[activeChat] || [] : [], [activeChat, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [cameraStream]);

  // === CAMERA FUNCTIONS ===
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 }, 
        audio: false 
      });
      setCameraStream(stream);
      setShowCamera(true);
      setCapturedPhoto(null);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch (err) {
      toast.error('No se pudo acceder a la cámara. Verifica los permisos.');
      console.error('Camera Error:', err);
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
    setCapturedPhoto(null);
  }, [cameraStream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedPhoto(dataUrl);
      // Stop live preview
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    }
  }, [cameraStream]);

  const sendPhoto = useCallback(() => {
    if (!capturedPhoto || !activeChat) return;
    
    const tracker = miningService.getTracker();
    if (tracker) tracker.addCallUnits(2); // Photos give 2 units

    const newMessage = {
      id: Date.now().toString(),
      senderId: currentUser?.id || 'me',
      receiverId: activeChatData?.userId || '',
      content: '📷 Foto enviada',
      type: 'text' as const,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false
    };
    addMessage(activeChat, newMessage);
    closeCamera();
    toast.success('Foto enviada');
  }, [capturedPhoto, activeChat, currentUser, activeChatData, addMessage, closeCamera]);

  // === MICROPHONE FUNCTIONS ===
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
          const tracker = miningService.getTracker();
          if (tracker) tracker.addCallUnits(3); // Voice messages give 3 units

          const newMessage = {
            id: Date.now().toString(),
            senderId: currentUser?.id || 'me',
            receiverId: activeChatData?.userId || '',
            content: `🎤 Nota de voz (${recordingTime}s)`,
            type: 'text' as const,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isRead: false
          };
          addMessage(activeChat, newMessage);
          toast.success('Nota de voz enviada');
        }
        setRecordingTime(0);
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      toast.error('No se pudo acceder al micrófono. Verifica los permisos.');
      console.error('Mic Error:', err);
    }
  }, [activeChat, currentUser, activeChatData, addMessage, recordingTime]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // === SEND TEXT MESSAGE ===
  const handleSendMessage = () => {
    if (!messageText.trim() || !activeChat) return;
    if (!checkRateLimit('send_message', 30, 60000)) {
      toast.error('Límite de mensajes alcanzado.');
      return;
    }
    const sanitizedContent = sanitize(messageText);
    const tracker = miningService.getTracker();
    if (tracker) tracker.addCallUnits(1);

    const newMessage = {
      id: Date.now().toString(),
      senderId: currentUser?.id || 'me',
      receiverId: activeChatData?.userId || '',
      content: sanitizedContent,
      type: 'text' as const,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false
    };
    addMessage(activeChat, newMessage);
    setMessageText('');
  };

  // === CHAT LIST VIEW ===
  if (!activeChat) {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0a]">
        <div className="bg-gradient-to-r from-purple-900 to-black p-4 flex flex-col gap-4 border-b border-purple-500/20">
          <div className="flex items-center justify-between">
            <h1 className="text-white text-xl font-black flex items-center gap-3">
              <button onClick={() => setCurrentTab('discover')} className="p-1 hover:bg-white/10 rounded-full" title="Volver">
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <WTEmblem size="sm" />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-yellow-500">WhaTaka</span>
            </h1>
            <div className="flex items-center gap-4 text-purple-300">
              <Search className="w-5 h-5 cursor-pointer hover:text-white" />
              <MoreVertical className="w-5 h-5 cursor-pointer hover:text-white" />
            </div>
          </div>
          <div className="flex justify-around items-center text-zinc-500 font-bold text-xs uppercase tracking-widest">
             <Camera className="w-5 h-5 hover:text-purple-400 cursor-pointer" />
             <span className="text-purple-400 border-b-2 border-purple-500 pb-2 flex items-center gap-2">
               CHATS <span className="bg-yellow-500 text-black text-[9px] px-1.5 rounded-full font-black">{chats.length}</span>
             </span>
             <span className="hover:text-purple-400 cursor-pointer">ESTADOS</span>
             <span className="hover:text-purple-400 cursor-pointer">LLAMADAS</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#0a0a0a] pb-20 scrollbar-hide">
          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => setActiveChat(chat.id)}
              className="w-full p-4 flex items-center gap-4 hover:bg-purple-900/10 transition-colors border-b border-zinc-900/50"
              title={`Chat con ${chat.username}`}
            >
              <div className="relative">
                <img src={chat.avatar} alt={chat.username} className="w-14 h-14 rounded-full object-cover border border-purple-500/30" />
                <div className="absolute -bottom-1 -right-1"><WTEmblem size="sm" /></div>
              </div>
              <div className="flex-1 text-left">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-white font-bold">{chat.username}</h3>
                  <span className="text-purple-500 text-[10px] font-bold">{chat.lastMessageTime}</span>
                </div>
                <p className="text-zinc-500 text-sm truncate">{chat.lastMessage}</p>
              </div>
            </button>
          ))}
        </div>

        <button 
          className="fixed bottom-24 right-6 w-16 h-16 bg-gradient-to-br from-purple-600 to-black border-2 border-yellow-500 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.4)] text-white z-50 hover:scale-105 transition-transform"
          title="Nuevo mensaje"
        >
          <MessageCircle className="w-7 h-7 text-yellow-500" />
        </button>
      </div>
    );
  }

  // === ACTIVE CHAT VIEW ===
  return (
    <div className="flex flex-col h-screen bg-black relative">
      {/* Camera Overlay */}
      {showCamera && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col">
          <div className="bg-gradient-to-r from-purple-900 to-black p-4 flex items-center justify-between">
            <button onClick={closeCamera} className="p-2 hover:bg-white/10 rounded-full" title="Cerrar cámara">
              <X className="w-6 h-6 text-white" />
            </button>
            <span className="text-purple-400 font-bold text-sm uppercase tracking-widest">Cámara WT</span>
            <div className="w-10" />
          </div>
          <div className="flex-1 flex items-center justify-center bg-black relative">
            {!capturedPhoto ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <img src={capturedPhoto} alt="Captura" className="w-full h-full object-cover" />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="bg-black p-6 flex items-center justify-center gap-8">
            {!capturedPhoto ? (
              <button 
                onClick={capturePhoto}
                className="w-20 h-20 rounded-full border-4 border-purple-500 bg-purple-600/30 hover:bg-purple-500/50 transition-all flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.5)]"
                title="Capturar foto"
              >
                <div className="w-16 h-16 rounded-full bg-white" />
              </button>
            ) : (
              <>
                <button onClick={() => { setCapturedPhoto(null); openCamera(); }} className="px-6 py-3 rounded-xl bg-zinc-800 text-white font-bold" title="Volver a tomar">
                  Retomar
                </button>
                <button onClick={sendPhoto} className="px-8 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-800 text-white font-bold border border-yellow-500/30 shadow-lg" title="Enviar foto">
                  <Send className="w-5 h-5 inline mr-2" /> Enviar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat Header */}
      <div className="bg-gradient-to-r from-purple-950 to-black px-3 py-3 flex items-center justify-between border-b border-purple-500/20 shadow-lg">
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveChat(null)} className="p-2 hover:bg-white/10 rounded-full" title="Volver">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="relative">
            <img src={activeChatData?.avatar} className="w-10 h-10 rounded-full object-cover border border-purple-500/30" alt="Av" />
            <div className="absolute -bottom-1 -right-1 scale-75"><WTEmblem size="sm" /></div>
          </div>
          <div>
            <h3 className="text-white font-bold text-sm truncate w-32">{activeChatData?.username}</h3>
            <p className="text-purple-400 text-[9px] font-bold uppercase tracking-widest">en línea</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-purple-300">
          <button className="p-1.5 hover:bg-white/10 rounded-full" title="Videollamada">
            <Video className="w-5 h-5 cursor-pointer hover:text-white" />
          </button>
          <button className="p-1.5 hover:bg-white/10 rounded-full" title="Llamada">
            <Phone className="w-5 h-5 cursor-pointer hover:text-white" />
          </button>
          <button className="p-1.5 hover:bg-white/10 rounded-full" title="Opciones">
            <MoreVertical className="w-5 h-5 cursor-pointer hover:text-white" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#050505] relative">
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none grid grid-cols-4 gap-10 p-10 rotate-12">
           {Array.from({length: 20}).map((_, i) => (
             <WTEmblem key={i} size="lg" />
           ))}
        </div>
        <div className="relative z-10 flex flex-col gap-3">
          {chatMessages.map((msg) => {
            const isMe = msg.senderId === currentUser?.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl shadow-xl ${
                  isMe 
                    ? 'bg-gradient-to-br from-purple-700 to-purple-900 text-white rounded-tr-none border border-purple-400/20' 
                    : 'bg-[#1a1a1a] text-white rounded-tl-none border border-zinc-800'
                }`}>
                   <p className="text-sm leading-relaxed">{msg.content}</p>
                   <div className="flex justify-end items-center gap-1.5 mt-2">
                     <span className="text-[10px] text-white/40 font-bold">{msg.timestamp}</span>
                     {isMe && <CheckCheck className="w-3.5 h-3.5 text-yellow-500" />}
                   </div>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Recording Overlay */}
      {isRecording && (
        <div className="absolute bottom-24 left-0 right-0 bg-gradient-to-r from-purple-900/95 to-black/95 p-4 flex items-center justify-between z-40 border-t border-purple-500/20 backdrop-blur-md">
           <div className="flex items-center gap-3">
             <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
             <span className="text-white font-bold text-lg">{recordingTime}s</span>
             <span className="text-purple-300 text-sm">Grabando nota de voz...</span>
           </div>
           <button 
             onClick={stopRecording}
             className="px-5 py-2.5 bg-yellow-500 text-black font-black rounded-full hover:bg-yellow-400 transition-all"
             title="Enviar nota de voz"
           >
              <Send className="w-4 h-4 inline mr-1" /> Enviar
           </button>
        </div>
      )}

      {/* Input Bar */}
      <div className="p-3 flex items-center gap-3 bg-[#0a0a0a] border-t border-purple-500/10 pb-20 sm:pb-3">
         <div className="flex-1 bg-[#1a1a1a] rounded-2xl px-4 py-2 flex items-center gap-3 border border-zinc-800">
            <Smile className="w-6 h-6 text-purple-400 cursor-pointer hover:text-purple-300" />
            <Input 
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Escribe un mensaje..." 
              className="bg-transparent border-none text-white focus-visible:ring-0 p-0 h-10 text-sm" 
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button onClick={openCamera} className="hover:opacity-80 transition-opacity" title="Abrir cámara">
              <Camera className="w-5 h-5 text-purple-400 cursor-pointer" />
            </button>
            <Paperclip className="w-5 h-5 text-zinc-500 rotate-45 cursor-pointer hover:text-white" />
         </div>
         <button 
           onClick={messageText.trim() ? handleSendMessage : (isRecording ? stopRecording : startRecording)} 
           className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all border ${
             isRecording 
               ? 'bg-red-600 border-red-400 animate-pulse' 
               : 'bg-gradient-to-br from-purple-600 to-purple-800 border-purple-400/30 hover:from-purple-500 hover:to-purple-700'
           }`}
           title={messageText.trim() ? "Enviar" : (isRecording ? "Detener grabación" : "Grabar nota de voz")}
         >
            {messageText.trim() ? (
              <Send className="w-5 h-5 text-white" />
            ) : isRecording ? (
              <MicOff className="w-5 h-5 text-white" />
            ) : (
              <Mic className="w-5 h-5 text-white" />
            )}
         </button>
      </div>
    </div>
  );
};
