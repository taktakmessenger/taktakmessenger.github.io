// Renovación de la sesión.
//
// La sesión se apoya en un token de 7 días y un refresco de 30. El frontend
// guardaba el de refresco pero nunca lo canjeaba, así que al caducar el token la
// app se quedaba "sin señal": las peticiones daban 401, el socket rechazaba el
// handshake y no había forma de recuperarse sin volver a entrar. Este módulo
// canjea el refresco por un token nuevo, sin molestar al usuario.

const TOKEN_KEY = 'taktak_token';
const USER_KEY = 'taktak_user';
const REFRESH_KEY = 'taktak_refresh';

// Quien quiera enterarse de que la sesión cambió (por ejemplo, para reconectar
// el socket con el token nuevo) se suscribe aquí. Sin esto, el token renovado
// quedaría solo en localStorage y el socket seguiría usando el caducado.
const listeners = new Set();

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(token) {
  listeners.forEach((fn) => {
    try {
      fn(token);
    } catch {
      // Un suscriptor que falla no debe tumbar a los demás.
    }
  });
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Guarda una sesión recién emitida (login, alta, verificación…). El refresco
// solo se pisa si viene: algunas respuestas lo renuevan y otras no.
export function saveSession(data) {
  if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
  notify(data.token || null);
}

export function hasRefreshToken() {
  return Boolean(localStorage.getItem(REFRESH_KEY));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(REFRESH_KEY);
  notify(null);
}

// Momento de caducidad del token (en ms), leído del propio JWT. Se decodifica
// sin verificar: aquí solo se usa para renovar a tiempo, no para confiar en el
// contenido. Si no se puede leer, se devuelve null y se renueva de forma
// reactiva (al primer 401) en lugar de por adelantado.
export function tokenExpiry(token) {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Una sola renovación en vuelo. Sin esto, una ráfaga de peticiones que reciben
// 401 a la vez dispararía una petición de refresco por cada una. Con una sola
// basta: todas comparten el mismo token nuevo.
let inFlight = null;

// Devuelve:
//   · un token (string) si la renovación salió bien;
//   · `null` si el refresco ya no vale (no hay, o el servidor lo rechazó): hay
//     que volver a entrar;
//   · `undefined` si el intento no pudo completarse (corte de red, servidor
//     reiniciándose): es pasajero, no se debe cerrar la sesión por esto.
export function refreshSession() {
  if (inFlight) return inFlight;

  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return Promise.resolve(null);

  // Se usa `fetch` y no el cliente `api` a propósito: el cliente trata el 401
  // renovando, y llamar a la renovación a través de él sería una recursión.
  inFlight = fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then((res) => {
      // Un 4xx del servidor es definitivo: ese refresco no sirve. Un 5xx o un
      // fallo de red son pasajeros.
      if (res.ok) return res.json();
      return res.status >= 400 && res.status < 500 ? null : undefined;
    })
    .then((data) => {
      if (data === undefined || data === null) return data;
      if (!data.token) return null;
      saveSession(data);
      return data.token;
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
