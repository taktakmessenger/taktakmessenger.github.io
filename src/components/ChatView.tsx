import { useState, useRef, useEffect } from 'react';
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

  const activeChatData = chats.find(c => c.id === activeChat);
  const chatMessages = activeChat ? messages[activeChat] || [] : [];

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
    <div className="flex flex-col h-screen bg-[#0a0a0a]">
      {/* WhatsApp Header */}
      <div className="bg-[#1f2c34] px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveChat(null)}>
            <ArrowLeft className="w-5 h-5 text-[#a9abad]" />
          </button>
          <img
            src={activeChatData?.avatar}
            alt={activeChatData?.username}
            className="w-9 h-9 rounded-full object-cover"
          />
          <div>
            <h3 className="text-[#e1e2e3] font-medium text-sm">{activeChatData?.username}</h3>
            <p className="text-[#667781] text-xs">
              {activeChatData?.isOnline ? 'en línea' : 'últ vez hoy'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-[#263238] rounded-full">
            <Phone className="w-5 h-5 text-[#a9abad]" />
          </button>
          <button className="p-2 hover:bg-[#263238] rounded-full">
            <Video className="w-5 h-5 text-[#a9abad]" />
          </button>
          <button className="p-2 hover:bg-[#263238] rounded-full">
            <MoreVertical className="w-5 h-5 text-[#a9abad]" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-[#0a0a0a]">
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
                      ? 'bg-[#005c4b] text-[#e1e2e3] rounded-tr-none' 
                      : 'bg-[#1f2c34] text-[#e1e2e3] rounded-tl-none'
                  }`}
                >
                  <p className="text-sm">{message.content}</p>
                </div>
                <div className={`flex items-center gap-1 mt-1 px-1 ${isMe ? 'justify-end' : ''}`}>
                  <span className="text-[#667781] text-[10px]">{message.timestamp}</span>
                  {isMe && (
                    message.isRead ?
                      <CheckCheck className="w-3 h-3 text-[#53bdeb]" /> :
                      <Check className="w-3 h-3 text-[#667781]" />
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-[#1f2c34] px-3 py-2 flex items-center gap-2">
        <button className="p-2 hover:bg-[#263238] rounded-full">
          <Smile className="w-5 h-5 text-[#a9abad]" />
        </button>
        <button className="p-2 hover:bg-[#263238] rounded-full">
          <Paperclip className="w-5 h-5 text-[#a9abad]" />
        </button>
        <div className="flex-1">
          <Input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Escribe un mensaje..."
            className="bg-[#2a3942] border-none text-white placeholder:text-[#667781]"
          />
        </div>
        {messageText.trim() ? (
          <button onClick={handleSendMessage} className="p-3 bg-[#00a884] hover:bg-[#009577] rounded-full">
            <Send className="w-5 h-5 text-white" />
          </button>
        ) : (
          <button className="p-3 bg-[#00a884] hover:bg-[#009577] rounded-full">
            <Mic className="w-5 h-5 text-white" />
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
    <div className="flex flex-col h-screen bg-[#12233e]">
      {/* Header */}
      <div className="bg-[#00a884] px-4 py-3 flex items-center gap-3">
        <MessageCircle className="w-6 h-6 text-white" />
        <h1 className="text-white font-medium">TakTak Web</h1>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg p-8 text-center max-w-sm">
          <div className="w-16 h-16 bg-[#e1e2e3] rounded-full flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-8 h-8 text-[#667781]" />
          </div>
          
          <h2 className="text-[#3b4a54] text-xl font-medium mb-2">
            Conecta tu teléfono
          </h2>
          <p className="text-[#667781] text-sm mb-6">
            Escanea este código QR con la app de TakTak en tu teléfono para vincular tu cuenta.
          </p>

          {/* QR Code Placeholder */}
          <div className="relative inline-block mb-6">
            <div className="w-48 h-48 bg-[#f0f2f5] border-2 border-[#00a884] rounded-lg flex items-center justify-center">
              <div className="grid grid-cols-5 gap-1 p-2">
                {Array.from({ length: 25 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-6 h-6 ${[4, 6, 8, 12, 14, 18, 20, 24].includes(i) ? 'bg-[#00a884]' : 'bg-white'}`}
                    style={{ borderRadius: i % 3 === 0 ? '50%' : '2px' }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={handleRefresh}
              className="absolute -right-3 -bottom-3 w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center shadow-lg"
            >
              <RefreshCw className={`w-5 h-5 text-white ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <p className="text-[#667781] text-xs mb-4">
            El código QR expira en 60 segundos
          </p>

          <Button
            onClick={onConnect}
            className="w-full bg-[#00a884] hover:bg-[#009577] text-white"
          >
            <QrCode className="w-4 h-4 mr-2" />
            Conectar automáticamente
          </Button>

          <div className="mt-6 pt-4 border-t border-[#e1e2e3]">
            <p className="text-[#3b4a54] text-xs mb-2">
              <strong>¿Necesitas ayuda?</strong>
            </p>
            <p className="text-[#667781] text-xs">
              Asegúrate de tener la última versión de TakTak instalada en tu teléfono.
              <br />
              Ve a <strong>Configuración &gt; Dispositivos vinculados</strong> para conectar.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-[#091b2b] px-4 py-3 text-center">
        <p className="text-[#667781] text-xs">
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

  const filteredChats = chats.filter(chat => 
    chat.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-[#12233e]">
      {/* Header */}
      <div className="bg-[#00a884] px-3 py-2">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-white text-xl font-medium">TakTak</h1>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-[#263238] rounded-full">
              <Settings className="w-5 h-5 text-white" />
            </button>
            <button className="p-2 hover:bg-[#263238] rounded-full">
              <MoreVertical className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#667781]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar..."
            className="pl-10 bg-[#233438] border-none text-white placeholder:text-[#667781] text-sm"
          />
        </div>
      </div>

      {/* Menu Tabs */}
      <div className="bg-[#091b2b] px-2 py-1 flex gap-1 overflow-x-auto">
        <button className="px-4 py-2 bg-[#00a884] text-white text-sm font-medium rounded-full whitespace-nowrap">
          <MessageCircle className="w-4 h-4 inline mr-1" />
          Chats
        </button>
        <button className="px-4 py-2 text-[#667781] text-sm hover:bg-[#263238] rounded-full whitespace-nowrap">
          <Archive className="w-4 h-4 inline mr-1" />
          Archivados
        </button>
        <button className="px-4 py-2 text-[#667781] text-sm hover:bg-[#263238] rounded-full whitespace-nowrap">
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
            className="w-full p-3 flex items-center gap-3 hover:bg-[#263238] transition-colors border-b border-[#233438]"
          >
            <div className="relative flex-shrink-0">
              <img
                src={chat.avatar}
                alt={chat.username}
                className="w-12 h-12 rounded-full object-cover"
              />
              {chat.isOnline && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.3 bg-[#25d366] rounded-full border-2 border-[#12233e]" />
              )}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center justify-between">
                <h3 className="text-[#e1e2e3] font-medium">{chat.username}</h3>
                <span className="text-[#667781] text-xs">{chat.lastMessageTime}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-[#667781] text-sm truncate">{chat.lastMessage}</p>
                {chat.unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-[#25d366] text-white text-xs rounded-full min-w-[20px] text-center">
                    {chat.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Floating Action Button */}
      <button className="fixed bottom-6 right-6 w-14 h-14 bg-[#25d366] rounded-full flex items-center justify-center shadow-lg">
        <MessageCircle className="w-6 h-6 text-white" />
      </button>
    </div>
  );
};
