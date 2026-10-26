import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { refreshSession } from '../lib/session';

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
      // Reconexión agresiva y sin límite: la app debe recuperar la "señal" sola
      // tras un corte de red o un reinicio del servidor, sin recargar.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    const onConnect = () => {
      setConnected(true);
      // Al conectar se informa de la visibilidad actual. El servidor solo manda
      // la llamada en vivo a un socket que puede repicar (pestaña visible) y
      // usa push para el resto: sin esto, una app en segundo plano dejaba el
      // socket abierto, el servidor la daba por disponible y no sonaba nada.
      instance.volatile.emit('app:visibility', { visible: document.visibilityState === 'visible' });
    };
    const onDisconnect = () => setConnected(false);

    // Cada cambio de primer plano/segundo plano se comunica. `volatile` a
    // propósito: es un dato efímero, y encolarlo mientras no hay conexión solo
    // reenviaría un estado viejo (el `onConnect` ya manda el actual).
    const onVisibility = () => {
      instance.volatile.emit('app:visibility', { visible: document.visibilityState === 'visible' });
    };
    document.addEventListener('visibilitychange', onVisibility);

    // El handshake solo lleva el token al conectar. Si este caducó, el servidor
    // rechaza la conexión con "Token inválido" y el socket reintentaría en vano
    // con el mismo token muerto para siempre. Aquí se renueva y se reconecta con
    // el token nuevo: `instance.auth` se lee en cada intento, así que basta con
    // actualizarlo y volver a llamar a `connect()`.
    let renewing = false;
    const onConnectError = async (err) => {
      setConnected(false);
      if (renewing || !/token/i.test(err?.message || '')) return;
      renewing = true;
      try {
        const fresh = await refreshSession();
        if (fresh && instance.auth) {
          instance.auth.token = fresh;
          instance.connect();
        }
      } finally {
        renewing = false;
      }
    };

    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);
    instance.on('connect_error', onConnectError);

    setSocket(instance);

    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.off('connect_error', onConnectError);
      document.removeEventListener('visibilitychange', onVisibility);
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

  // Emitir y esperar respuesta. La señalización del SFU necesita el resultado
  // para continuar (crear el transporte, publicar…): con un `await` el flujo
  // queda lineal en lugar de encadenar eventos. El temporizador evita que un
  // servidor que no contesta deje la promesa colgada para siempre.
  const emitAck = useCallback(
    (event, payload, timeoutMs = 8000) =>
      new Promise((resolve, reject) => {
        if (!socket) {
          reject(new Error('Sin conexión'));
          return;
        }
        const timer = setTimeout(() => reject(new Error('Tiempo de espera agotado')), timeoutMs);
        socket.emit(event, payload, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
      }),
    [socket]
  );

  const value = useMemo(
    () => ({ socket, connected, emit, emitAck, subscribe }),
    [socket, connected, emit, emitAck, subscribe]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket debe usarse dentro de SocketProvider');
  return ctx;
}
