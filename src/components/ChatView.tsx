import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Phone, Video, MoreVertical,
  Send, Mic, Smile, Check, CheckCheck,
  QrCode, RefreshCw, Smartphone, MessageCircle, Search,
  Paperclip, Archive, Star, Settings
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSecurity } from '@/hooks/useSecurity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GiftModal } from './GiftModal';
import { toast } from 'sonner';

export const ChatView = () => {
  const { chats, messages, activeChat, setActiveChat, addMessage, markAsRead, currentUser } = useStore();
  const { sanitize, encrypt, checkRateLimit } = useSecurity();
  const [messageText, setMessageText] = useState('');
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChatData = useMemo(() => chats.find(c => c.id === activeChat), [chats, activeChat]);
  const chatMessages = useMemo(() => activeChat ? messages[activeChat] || [] : [], [activeChat, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (activeChat) {
      markAsRead(activeChat);
    }
  }, [activeChat, markAsRead]);

  const handleConnect = () => {
    setIsConnected(true);
    toast.success('¡Teléfono conectado exitosamente!');
  };

  const handleSendMessage = () => {
    if (!messageText.trim() || !activeChat) return;

    if (!checkRateLimit('send_message', 20, 60000)) {
      toast.error('Demasiados mensajes. Por favor espera un momento.');
      return;
    }

    const sanitizedContent = sanitize(messageText);
    encrypt(sanitizedContent);

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isConnected) {
    return <WhatsAppConnect onConnect={handleConnect} />;
  }

  if (!activeChat) {
    return <WhatsAppChatList onSelectChat={(id) => setActiveChat(id)} />;
  }

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* WhatsApp Header */}
      <div className="bg-black border-b border-zinc-800 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveChat(null)} aria-label="Volver" title="Volver">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <img
            src={activeChatData?.avatar}
            alt={activeChatData?.username}
            className="w-9 h-9 rounded-full object-cover"
          />
          <div>
            <h3 className="text-white font-medium text-sm">{activeChatData?.username}</h3>
            <p className="text-zinc-500 text-xs">
              {activeChatData?.isOnline ? 'en línea' : 'últ vez hoy'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Llamada de voz" title="Llamada de voz">
            <Phone className="w-5 h-5 text-white" />
          </button>
          <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Videollamada" title="Videollamada">
            <Video className="w-5 h-5 text-white" />
          </button>
          <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Más opciones" title="Más opciones">
            <MoreVertical className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-black">
        {chatMessages.map((message) => {
          const isMe = message.senderId === currentUser?.id;

          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                <div
                  className={`px-3 py-2 rounded-lg ${
                    isMe 
                      ? 'bg-purple-600 text-white rounded-tr-none' 
                      : 'bg-zinc-800 text-white rounded-tl-none'
                  }`}
                >
                  <p className="text-sm">{message.content}</p>
                </div>
                <div className={`flex items-center gap-1 mt-1 px-1 ${isMe ? 'justify-end' : ''}`}>
                  <span className="text-zinc-500 text-[10px]">{message.timestamp}</span>
                  {isMe && (
                    message.isRead ?
                      <CheckCheck className="w-3 h-3 text-cyan-400" /> :
                      <Check className="w-3 h-3 text-zinc-500" />
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-black border-t border-zinc-800 px-3 py-2 flex items-center gap-2">
        <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Emojis" title="Emojis">
          <Smile className="w-5 h-5 text-zinc-400" />
        </button>
        <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Adjuntar" title="Adjuntar">
          <Paperclip className="w-5 h-5 text-zinc-400" />
        </button>
        <div className="flex-1">
          <Input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Escribe un mensaje..."
            className="bg-zinc-900 border-none text-white placeholder:text-zinc-500"
          />
        </div>
        {messageText.trim() ? (
          <button onClick={handleSendMessage} className="p-3 bg-cyan-400 hover:bg-cyan-500 rounded-full" aria-label="Enviar" title="Enviar">
            <Send className="w-5 h-5 text-black" />
          </button>
        ) : (
          <button className="p-3 bg-cyan-400 hover:bg-cyan-500 rounded-full" aria-label="Micrófono" title="Micrófono">
            <Mic className="w-5 h-5 text-black" />
          </button>
        )}
      </div>

      {/* Gift Modal */}
      <AnimatePresence>
        {showGiftModal && (
          <GiftModal
            videoId={activeChat || ''}
            onClose={() => setShowGiftModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const WhatsAppConnect = ({ onConnect }: { onConnect: () => void }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Header */}
      <div className="bg-black border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <MessageCircle className="w-6 h-6 text-white" />
        <h1 className="text-white font-medium">TakTak Web</h1>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-black">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center max-w-sm">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-zinc-700">
            <Smartphone className="w-8 h-8 text-white" />
          </div>
          
          <h2 className="text-white text-xl font-medium mb-2">
            Conecta tu teléfono
          </h2>
          <p className="text-zinc-400 text-sm mb-6">
            Escanea este código QR con la app de TakTak en tu teléfono para vincular tu cuenta.
          </p>

          {/* QR Code Placeholder */}
          <div className="relative inline-block mb-6">
            <div className="w-48 h-48 bg-white border-2 border-zinc-800 rounded-lg flex items-center justify-center">
              <div className="grid grid-cols-5 gap-1 p-2">
                {Array.from({ length: 25 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-6 h-6 ${[4, 6, 8, 12, 14, 18, 20, 24].includes(i) ? 'bg-black' : 'bg-transparent'} ${i % 3 === 0 ? 'rounded-full' : 'rounded-sm'}`}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={handleRefresh}
              className="absolute -right-3 -bottom-3 w-10 h-10 bg-cyan-400 hover:bg-cyan-500 rounded-full flex items-center justify-center shadow-lg"
              aria-label="Refrescar código QR"
              title="Refrescar código QR"
            >
              <RefreshCw className={`w-5 h-5 text-black ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <p className="text-zinc-500 text-xs mb-4">
            El código QR expira en 60 segundos
          </p>

          <Button
            onClick={onConnect}
            className="w-full bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-black font-bold"
          >
            <QrCode className="w-4 h-4 mr-2" />
            Conectar automáticamente
          </Button>

          <div className="mt-6 pt-4 border-t border-zinc-800">
            <p className="text-zinc-300 text-xs mb-2">
              <strong>¿Necesitas ayuda?</strong>
            </p>
            <p className="text-zinc-500 text-xs">
              Asegúrate de tener la última versión de TakTak instalada en tu teléfono.
              <br />
              Ve a <strong>Configuración &gt; Dispositivos vinculados</strong> para conectar.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-black border-t border-zinc-800 px-4 py-3 text-center">
        <p className="text-zinc-500 text-xs">
          <MessageCircle className="w-3 h-3 inline mr-1" />
          Tus mensajes están seguros y encriptados de extremo a extremo
        </p>
      </div>
    </div>
  );
};

const WhatsAppChatList = ({ onSelectChat }: { onSelectChat: (id: string) => void }) => {
  const { chats } = useStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChats = useMemo(() => chats.filter(chat => 
    chat.username.toLowerCase().includes(searchQuery.toLowerCase())
  ), [chats, searchQuery]);

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Header */}
      <div className="bg-black border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-white text-xl font-medium">TakTak</h1>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Configuración" title="Configuración">
              <Settings className="w-5 h-5 text-white" />
            </button>
            <button className="p-2 hover:bg-zinc-800 rounded-full" aria-label="Más opciones" title="Más opciones">
              <MoreVertical className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar..."
            className="pl-10 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500 text-sm"
          />
        </div>
      </div>

      {/* Menu Tabs */}
      <div className="bg-black border-b border-zinc-800 px-2 py-2 flex gap-1 overflow-x-auto">
        <button className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium rounded-full whitespace-nowrap shadow-lg shadow-purple-500/20">
          <MessageCircle className="w-4 h-4 inline mr-1" />
          Chats
        </button>
        <button className="px-4 py-2 text-zinc-400 text-sm hover:bg-zinc-900 rounded-full whitespace-nowrap">
          <Archive className="w-4 h-4 inline mr-1" />
          Archivados
        </button>
        <button className="px-4 py-2 text-zinc-400 text-sm hover:bg-zinc-900 rounded-full whitespace-nowrap">
          <Star className="w-4 h-4 inline mr-1" />
          Destacados
        </button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.map((chat) => (
          <motion.button
            key={chat.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectChat(chat.id)}
            className="w-full p-4 flex items-center gap-4 hover:bg-zinc-900 transition-colors border-b border-zinc-900/50"
          >
            <div className="relative flex-shrink-0">
              <img
                src={chat.avatar}
                alt={chat.username}
                className="w-12 h-12 rounded-full object-cover"
              />
              {chat.isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-black" />
              )}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-white font-medium">{chat.username}</h3>
                <span className="text-zinc-500 text-xs">{chat.lastMessageTime}</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-zinc-400 text-sm truncate pr-2">{chat.lastMessage}</p>
                {chat.unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold text-xs rounded-full min-w-[20px] text-center">
                    {chat.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Floating Action Button */}
      <button 
        className="fixed bottom-24 lg:bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(236,72,153,0.3)] transition-all active:scale-95 z-50"
        aria-label="Nuevo mensaje"
        title="Nuevo mensaje"
      >
        <MessageCircle className="w-6 h-6 text-white" />
      </button>
    </div>
  );
};
