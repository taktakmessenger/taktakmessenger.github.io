import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ADMIN_ACCOUNTS = [
  'eliecerdepablos@gmail.com',
  'elmalayaso7@gmail.com'
];

export interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  avatar: string;
  followers: number;
  following: number;
  likes: number;
  bio: string;
  isVerified: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}

export interface Video {
  id: string;
  userId: string;
  username: string;
  userAvatar: string;
  videoUrl: string;
  thumbnail: string;
  caption: string;
  likes: number;
  comments: number;
  shares: number;
  gifts: number;
  isLiked: boolean;
  isFollowing: boolean;
  createdAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'gift';
  timestamp: string;
  isRead: boolean;
}

export interface Chat {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  isOnline: boolean;
}

export interface Gift {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  animation: string;
  createdBy?: string;
  isCustom: boolean;
}

export interface CustomGift {
  id: string;
  name: string;
  image: string;
  price: number;
  creatorId: string;
  creatorName: string;
  createdAt: string;
}

interface AppState {
  // User
  currentUser: User | null;
  isAuthenticated: boolean;
  setCurrentUser: (user: User | null) => void;
  login: (user: User) => void;
  logout: () => void;
  
  // Videos
  videos: Video[];
  currentVideoIndex: number;
  setVideos: (videos: Video[]) => void;
  addVideo: (video: Video) => void;
  likeVideo: (videoId: string) => void;
  followUser: (userId: string) => void;
  setCurrentVideoIndex: (index: number) => void;
  
  // Chat
  chats: Chat[];
  messages: Record<string, Message[]>;
  activeChat: string | null;
  setActiveChat: (chatId: string | null) => void;
  addMessage: (chatId: string, message: Message) => void;
  markAsRead: (chatId: string) => void;
  
  // Gifts
  gifts: Gift[];
  customGifts: CustomGift[];
  addCustomGift: (gift: CustomGift) => void;
  sendGift: (videoId: string, giftId: string) => void;
  
  // Payments
  balance: number;
  addBalance: (amount: number) => void;
  
  // Navigation
  currentTab: 'home' | 'discover' | 'poker' | 'create' | 'wallet' | 'chat' | 'profile';
  setCurrentTab: (tab: 'home' | 'discover' | 'poker' | 'create' | 'wallet' | 'chat' | 'profile') => void;
  
  // Admin
  adminEarnings: number;
  addEarnings: (amount: number) => void;
}

const defaultGifts: Gift[] = [
  { id: '1', name: 'Corazón', description: 'Muestra tu amor', price: 0.50, image: '❤️', animation: 'bounce', isCustom: false },
  { id: '2', name: 'Fuego', description: 'Caliente el ambiente', price: 1.00, image: '🔥', animation: 'shake', isCustom: false },
  { id: '3', name: 'Diamante', description: 'Eres único', price: 5.00, image: '💎', animation: 'sparkle', isCustom: false },
  { id: '4', name: 'Corona', description: 'El mejor contenido', price: 10.00, image: '👑', animation: 'glow', isCustom: false },
  { id: '5', name: 'Cohete', description: 'Despega con estilo', price: 25.00, image: '🚀', animation: 'fly', isCustom: false },
  { id: '6', name: 'Universo', description: 'Infinitas posibilidades', price: 50.00, image: '🌌', animation: 'expand', isCustom: false },
];

const mockVideos: Video[] = [
  {
    id: '1',
    userId: 'user1',
    username: 'creator_star',
    userAvatar: 'https://i.pravatar.cc/150?u=user1',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=600',
    caption: '¡Nuevo contenido exclusivo! 🔥 #viral #trend',
    likes: 12500,
    comments: 342,
    shares: 189,
    gifts: 45,
    isLiked: false,
    isFollowing: false,
    createdAt: '2024-01-15T10:30:00Z'
  },
  {
    id: '2',
    userId: 'user2',
    username: 'dance_queen',
    userAvatar: 'https://i.pravatar.cc/150?u=user2',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1547153760-18fc86324498?w=600',
    caption: '¿Te gusta mi baile? 💃 #dance #music',
    likes: 89300,
    comments: 1205,
    shares: 3400,
    gifts: 230,
    isLiked: true,
    isFollowing: true,
    createdAt: '2024-01-15T09:15:00Z'
  },
  {
    id: '3',
    userId: 'user3',
    username: 'comedy_king',
    userAvatar: 'https://i.pravatar.cc/150?u=user3',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=600',
    caption: 'Cuando tu crush te responde 😂 #comedy #funny',
    likes: 45600,
    comments: 890,
    shares: 5600,
    gifts: 120,
    isLiked: false,
    isFollowing: false,
    createdAt: '2024-01-15T08:00:00Z'
  },
  {
    id: '4',
    userId: 'user4',
    username: 'music_producer',
    userAvatar: 'https://i.pravatar.cc/150?u=user4',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=600',
    caption: 'Nuevo beat disponible 🎵 #music #producer',
    likes: 23400,
    comments: 456,
    shares: 1200,
    gifts: 78,
    isLiked: false,
    isFollowing: false,
    createdAt: '2024-01-15T07:30:00Z'
  },
  {
    id: '5',
    userId: 'user5',
    username: 'travel_vibes',
    userAvatar: 'https://i.pravatar.cc/150?u=user5',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600',
    caption: 'Paraíso encontrado 🌴 #travel #paradise',
    likes: 67800,
    comments: 1500,
    shares: 8900,
    gifts: 340,
    isLiked: true,
    isFollowing: false,
    createdAt: '2024-01-15T06:00:00Z'
  }
];

const mockChats: Chat[] = [
  {
    id: 'chat1',
    userId: 'user2',
    username: 'dance_queen',
    avatar: 'https://i.pravatar.cc/150?u=user2',
    lastMessage: '¡Gracias por el regalo! 💕',
    lastMessageTime: '10:30',
    unreadCount: 2,
    isOnline: true
  },
  {
    id: 'chat2',
    userId: 'user3',
    username: 'comedy_king',
    avatar: 'https://i.pravatar.cc/150?u=user3',
    lastMessage: 'Jajaja eso fue gracioso',
    lastMessageTime: '09:45',
    unreadCount: 0,
    isOnline: false
  },
  {
    id: 'chat3',
    userId: 'user6',
    username: 'fan_lover',
    avatar: 'https://i.pravatar.cc/150?u=user6',
    lastMessage: '¿Cuándo subes nuevo contenido?',
    lastMessageTime: 'Ayer',
    unreadCount: 5,
    isOnline: true
  }
];

const mockMessages: Record<string, Message[]> = {
  chat1: [
    { id: 'm1', senderId: 'user2', receiverId: 'me', content: '¡Hola! ¿Cómo estás?', type: 'text', timestamp: '10:25', isRead: true },
    { id: 'm2', senderId: 'me', receiverId: 'user2', content: 'Muy bien, gracias! Me encanta tu contenido', type: 'text', timestamp: '10:27', isRead: true },
    { id: 'm3', senderId: 'user2', receiverId: 'me', content: '¡Gracias por el regalo! 💕', type: 'text', timestamp: '10:30', isRead: false },
    { id: 'm4', senderId: 'user2', receiverId: 'me', content: 'Eres el mejor!', type: 'text', timestamp: '10:31', isRead: false }
  ],
  chat2: [
    { id: 'm1', senderId: 'user3', receiverId: 'me', content: '¿Viste el nuevo video?', type: 'text', timestamp: '09:40', isRead: true },
    { id: 'm2', senderId: 'me', receiverId: 'user3', content: 'Sí, jajaja eso fue gracioso', type: 'text', timestamp: '09:45', isRead: true }
  ]
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // User
      currentUser: {
        id: 'me',
        username: 'taktak_user',
        email: 'eliecerdepablos@gmail.com',
        avatar: 'https://i.pravatar.cc/150?u=me',
        followers: 1250,
        following: 340,
        likes: 8900,
        bio: 'Creador de contenido en TakTak 🎵✨',
        isVerified: true,
        isAdmin: true,
        isOwner: true
      },
      isAuthenticated: true,
      setCurrentUser: (user) => set({ currentUser: user }),
      login: (user) => set({ currentUser: user, isAuthenticated: true }),
      logout: () => set({ currentUser: null, isAuthenticated: false }),
      
      // Videos
      videos: mockVideos,
      currentVideoIndex: 0,
      setVideos: (videos) => set({ videos }),
      addVideo: (video) => set((state) => ({ videos: [video, ...state.videos] })),
      likeVideo: (videoId) => set((state) => ({
        videos: state.videos.map(v => 
          v.id === videoId ? { ...v, isLiked: !v.isLiked, likes: v.isLiked ? v.likes - 1 : v.likes + 1 } : v
        )
      })),
      followUser: (userId) => set((state) => ({
        videos: state.videos.map(v => 
          v.userId === userId ? { ...v, isFollowing: !v.isFollowing } : v
        )
      })),
      setCurrentVideoIndex: (index) => set({ currentVideoIndex: index }),
      
      // Chat
      chats: mockChats,
      messages: mockMessages,
      activeChat: null,
      setActiveChat: (chatId) => set({ activeChat: chatId }),
      addMessage: (chatId, message) => set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: [...(state.messages[chatId] || []), message]
        }
      })),
      markAsRead: (chatId) => set((state) => ({
        chats: state.chats.map(c => 
          c.id === chatId ? { ...c, unreadCount: 0 } : c
        )
      })),
      
      // Gifts
      gifts: defaultGifts,
      customGifts: [],
      addCustomGift: (gift) => set((state) => ({ 
        customGifts: [...state.customGifts, gift] 
      })),
      sendGift: (videoId, giftId) => {
        const gift = get().gifts.find(g => g.id === giftId);
        if (gift) {
          set((state) => ({
            videos: state.videos.map(v => 
              v.id === videoId ? { ...v, gifts: v.gifts + 1 } : v
            ),
            balance: state.balance - gift.price
          }));
        }
      },
      
      // Payments
      balance: 100.00,
      addBalance: (amount) => set((state) => ({ balance: state.balance + amount })),
      
      // Navigation
      currentTab: 'home',
      setCurrentTab: (tab) => set({ currentTab: tab }),
      
      // Admin
      adminEarnings: 0,
      addEarnings: (amount) => set((state) => ({ adminEarnings: state.adminEarnings + amount }))
    }),
    {
      name: 'taktak-storage',
      partialize: (state) => ({ 
        currentUser: state.currentUser, 
        isAuthenticated: state.isAuthenticated,
        balance: state.balance,
        customGifts: state.customGifts,
        adminEarnings: state.adminEarnings
      })
    }
  )
);
