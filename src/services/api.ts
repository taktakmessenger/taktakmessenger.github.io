import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

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
    email?: string; 
    dob: string; 
    legalAccepted: boolean; 
    privacyAccepted: boolean; 
    referredByCode?: string;
  }) => api.post('/auth/register', data),
  
  verify: (phone: string, otp: string) => api.post('/auth/verify', { phone, otp }),
  
  login: (phone: string) => api.post('/auth/login', { phone }),
  
  getMe: () => api.get('/auth/me'),

  updateProfile: (data: { username: string; dob: string; legalAccepted: boolean; privacyAccepted: boolean }) => 
    api.put('/auth/profile', data),

  setupSecurity: (data: { securityQuestion: string; securityAnswer: string; recoveryPhrase: string }) => 
    api.post('/auth/security-setup', data),
};

export const paymentApi = {
  createIntent: (amount: number, currency = 'usd') => api.post('/payments/create-intent', { amount, currency }),
  confirm: (paymentIntentId: string) => api.post('/payments/confirm', { paymentIntentId }),
  withdraw: (data: { amount: number; method: string; details: Record<string, unknown> }) => api.post('/payments/withdraw', data),
};

export default api;
