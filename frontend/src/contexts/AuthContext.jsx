import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { detachPushSubscription } from '../services/push';

const AuthContext = createContext(null);

// A corrupted or hand-edited value must not crash the render: JSON.parse throws
// and, with no error boundary above it, React would unmount the whole app and
// leave a blank page. Drop the bad value instead and fall back to logged out.
function readStoredUser() {
  const raw = localStorage.getItem('taktak_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem('taktak_user');
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('taktak_token'));
  const [user, setUser] = useState(readStoredUser);
  const [loading, setLoading] = useState(Boolean(token));

  // Re-validate a persisted token against the server on boot so a revoked or
  // expired session does not leave the UI in a logged-in state.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      return undefined;
    }

    api
      .get('/users/me')
      .then((res) => {
        if (cancelled) return;
        setUser(res.data.user);
        localStorage.setItem('taktak_user', JSON.stringify(res.data.user));
      })
      .catch(() => {
        if (cancelled) return;
        logout();
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(data) {
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('taktak_token', data.token);
    localStorage.setItem('taktak_user', JSON.stringify(data.user));
    // The refresh token outlives the access token and is the only thing that
    // can mint a new session. Losing it on reload would silently log the user
    // out after an hour.
    if (data.refreshToken) {
      localStorage.setItem('taktak_refresh', data.refreshToken);
    }
  }

  async function login(identifier, password, country) {
    const { data } = await api.post('/auth/login', { identifier, password, country });
    persist(data);
  }

  async function register(username, email, password) {
    const { data } = await api.post('/auth/register', { username, email, password });
    persist(data);
    // Returned so the form can show the code when the mail could not be sent
    // (development), instead of a "check your inbox" screen for nothing.
    return data;
  }

  // Google returns an ID token from the browser SDK; the server verifies its
  // signature before creating the session.
  async function loginWithGoogle(idToken) {
    const { data } = await api.post('/auth/google', { idToken });
    persist(data);
  }

  // Phone sign-up is two steps: request a code, then verify it. The account is
  // created by the second call, so an unverified number cannot take it.
  async function startPhoneSignup({ phone, country, username, password }) {
    const { data } = await api.post('/auth/phone/start', {
      phone,
      country,
      username: username || undefined,
      password: password || undefined,
    });
    return data;
  }

  async function verifyPhoneSignup({ phone, country, code }) {
    const { data } = await api.post('/auth/phone/verify', { phone, country, code });
    persist(data);
    return data;
  }

  // Vincular un teléfono a una cuenta que ya existe (creada por correo o
  // Google). Va autenticado y en dos pasos, igual que el registro por teléfono:
  // primero se pide el código, luego se verifica. El número se adjunta a la
  // cuenta de la sesión, nunca crea ni cambia de cuenta.
  async function startPhoneLink({ phone, country }) {
    const { data } = await api.post('/auth/phone/link/start', { phone, country });
    return data;
  }

  async function verifyPhoneLink({ phone, country, code }) {
    const { data } = await api.post('/auth/phone/link/verify', { phone, country, code });
    // La respuesta trae el usuario ya con el teléfono: se refresca la sesión
    // para que Ajustes y el marcador lo vean sin recargar.
    if (data.user) {
      setUser(data.user);
      localStorage.setItem('taktak_user', JSON.stringify(data.user));
    }
    return data;
  }

  async function forgotPassword(email) {
    const { data } = await api.post('/auth/forgot-password', { email });
    return data;
  }

  async function resetPassword({ email, code, password }) {
    const { data } = await api.post('/auth/reset-password', { email, code, password });
    persist(data);
    return data;
  }

  async function logout() {
    // Se desvincula el dispositivo del usuario *antes* de borrar el token: la
    // llamada al servidor necesita la sesión. Si no se hiciera, a este teléfono
    // le seguirían sonando las llamadas de quien acaba de salir.
    await detachPushSubscription();
    setToken(null);
    setUser(null);
    localStorage.removeItem('taktak_token');
    localStorage.removeItem('taktak_user');
    localStorage.removeItem('taktak_refresh');
  }

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      login,
      register,
      loginWithGoogle,
      startPhoneSignup,
      verifyPhoneSignup,
      startPhoneLink,
      verifyPhoneLink,
      forgotPassword,
      resetPassword,
      logout,
      setUser,
    }),
    [token, user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
