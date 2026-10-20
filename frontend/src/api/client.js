import axios from 'axios';
import { isJsonResponse, messageFromError } from './response.js';

// A single configured client so the auth header and error shape are applied
// consistently everywhere.
const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('taktak_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Surface the server's message (our API always sends `error`) instead of a
// generic axios error, and drop a stale token on 401.
//
// Exported so a test can drive them with a real axios instance against a real
// server, instead of asserting on a copy of the logic.
export function onResponse(res) {
  // The API answers JSON on every path, including errors. A non-JSON body
  // means the request never reached the API — a static host served the SPA
  // shell, or a proxy returned its own error page. Fail here with a clear
  // message instead of letting a component read fields off an HTML string.
  if (!isJsonResponse(res) || typeof res.data !== 'object' || res.data === null) {
    return Promise.reject(new Error(messageFromError({ response: res })));
  }
  return res;
}

export function onResponseError(error) {
  if (error.response?.status === 401) {
    localStorage.removeItem('taktak_token');
    localStorage.removeItem('taktak_user');
  }
  return Promise.reject(new Error(messageFromError(error)));
}

api.interceptors.response.use(onResponse, onResponseError);

export default api;
