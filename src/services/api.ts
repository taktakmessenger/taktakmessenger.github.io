import axios from 'axios';

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && window.location.hostname.includes('github.io')) {
    return 'https://taktak-app.onrender.com/api';
  }
  return 'http://157.90.244.93:3000/api';
};

const API_URL = getBaseUrl();

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('taktak_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  register: (data: { 
    phone: string; 
    username: string; 
    password?: string;
    email?: string; 
    dob: string; 
    legalAccepted: boolean; 
    privacyAccepted: boolean; 
    referredByCode?: string;
  }) => api.post('/auth/register', data),
  
  verify: (identifier: string, otp: string) => api.post('/auth/verify', { identifier, otp }),
  
  login: (identifier: string) => api.post('/auth/login', { identifier }),
  
  loginWithPassword: (identifier: string, password: string) => 
    api.post('/auth/login-password', { identifier, password }),
  
  resetPassword: (identifier: string, code: string, password: string) => 
    api.post('/auth/reset-password', { identifier, code, password }),
  
  getMe: () => api.get('/auth/me'),

  updateProfile: (data: { 
    username: string; 
    dob: string; 
    legalAccepted: boolean; 
    privacyAccepted: boolean;
    firstName?: string;
    lastName?: string;
  }) => api.put('/auth/profile', data),

  setupSecurity: (data: { securityQuestion: string; securityAnswer: string; recoveryPhrase: string }) => 
    api.post('/auth/security-setup', data),

  recoverAccount: (data: { identifier: string; recoveryPhrase: string; securityAnswer?: string }) =>
    api.post('/auth/recover', data),
};

export const paymentApi = {
  createIntent: (amount: number, currency = 'usd') => api.post('/payments/create-intent', { amount, currency }),
  confirm: (paymentIntentId: string) => api.post('/payments/confirm', { paymentIntentId }),
  withdraw: (data: { amount: number; method: string; details: Record<string, unknown> }) => api.post('/payments/withdraw', data),
};

export const chatApi = {
  getChats: () => api.get('/chats'),
  createChat: (participantId: string) => api.post('/chats', { participantId }),
  getChatById: (chatId: string) => api.get(`/chats/${chatId}`)
};

export const messageApi = {
  getHistory: (chatId: string, skip = 0, limit = 50) => 
    api.get(`/messages/${chatId}?skip=${skip}&limit=${limit}`),
  markAsRead: (chatId: string) => api.post(`/messages/${chatId}/read`)
};

export default api;
