import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

// One socket for the whole app.
//
// A per-component socket would mean a new connection for the chat, another for
// calls and another for the live view, and an incoming call would only ring if
// the call component happened to be mounted. A single connection owned by a
// provider keeps the user reachable from any screen.
export function SocketProvider({ children }) {
  const { token, user } = useAuth();

  // The instance lives in state, not a ref, so consumers re-render when it
  // appears. With a ref, a component that mounted before the socket existed
  // would subscribe to nothing and never be told.
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // Señal de conexión para las pruebas de extremo a extremo, que necesitan
  // saber cuándo el socket está listo antes de intentar una llamada. Solo en
  // desarrollo: en producción no se expone nada al `window`.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__taktakSocketConnected = connected;
    return undefined;
  }, [connected]);

  useEffect(() => {
    // No session, no socket. An anonymous visitor has nothing to subscribe to.
    if (!token || !user) {
      setSocket(null);
      setConnected(false);
      return undefined;
    }

    const instance = io({
      auth: { token },
      // Same origin as the page: in dev Vite proxies it, in production nginx
      // does. Hardcoding a host here would break both.
      transports: ['websocket', 'polling'],
    });

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);
    instance.on('connect_error', onDisconnect);

    setSocket(instance);

    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.off('connect_error', onDisconnect);
      instance.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token, user]);

  // Stable emitter so consumers can call it from an effect without re-running
  // it on every render.
  const emit = useCallback((event, payload) => {
    socket?.emit(event, payload);
  }, [socket]);

  // Subscribing returns an unsubscribe function, so an effect can clean up with
  // `return subscribe(...)`. Depends on `socket` so effects re-run once the
  // connection is up and register for real.
  const subscribe = useCallback(
    (event, handler) => {
      if (!socket) return () => {};
      socket.on(event, handler);
      return () => socket.off(event, handler);
    },
    [socket]
  );

  const value = useMemo(
    () => ({ socket, connected, emit, subscribe }),
    [socket, connected, emit, subscribe]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket debe usarse dentro de SocketProvider');
  return ctx;
}
