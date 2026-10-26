import axios from 'axios';
import { isJsonResponse, messageFromError } from './response.js';
import { getToken, clearSession, refreshSession, hasRefreshToken } from '../lib/session.js';

// A single configured client so the auth header and error shape are applied
// consistently everywhere.
const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
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

export async function onResponseError(error) {
  const { response, config } = error;

  // Un 401 con un token caducado no debe echar al usuario: se renueva la sesión
  // y se reintenta la petición una sola vez. Antes, el primer 401 borraba la
  // sesión, así que "se caía la señal" en cuanto el token cumplía su hora.
  if (response?.status === 401 && config && !config.__retried && hasRefreshToken()) {
    const token = await refreshSession();
    // `undefined` = fallo pasajero (red/servidor): no se cierra sesión ni se
    // reintenta con un token que no hay; se deja que el usuario reintente.
    if (token) {
      // El interceptor de petición vuelve a poner el encabezado desde el
      // almacén, donde `refreshSession` ya dejó el token nuevo.
      return api({ ...config, __retried: true });
    }
    if (token === undefined) {
      return Promise.reject(new Error(messageFromError(error)));
    }
    // `null` = el refresco ya no vale: hay que volver a entrar.
    clearSession();
  }

  if (response?.status === 401) {
    // Sin refresco, o con uno inservible: la sesión ya no da más de sí.
    clearSession();
  }
  // El código viaja con el error: quien llama necesita distinguir "la cuenta ya
  // no existe" (404, hay que cerrar sesión) de un fallo de red, y el mensaje
  // solo no basta. Sin esto, `AuthContext` no podía saber que el 404 de
  // `/users/me` era una cuenta eliminada y dejaba la sesión abierta y rota.
  const failure = new Error(messageFromError(error));
  if (response?.status) failure.status = response.status;
  return Promise.reject(failure);
}

api.interceptors.response.use(onResponse, onResponseError);

export default api;
