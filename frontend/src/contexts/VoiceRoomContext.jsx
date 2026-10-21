import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { unlockAudio } from '../lib/ringtone';

const VoiceRoomContext = createContext(null);

// Mismos STUN por defecto que las llamadas 1 a 1. La lista real llega de
// `/calls/ice`, que puede incluir TURN.
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Sala de voz de un TAK Creator.
 *
 * Hay dos formas de transportar el audio, y el servidor decide cuál se usa para
 * cada sala (viaja en `voice:joined.mode`):
 *
 * - `sfu`: el audio pasa por un servidor de reenvío (mediasoup). Cada persona
 *   sube UN flujo y el servidor lo reparte. El coste de subida no crece con el
 *   número de participantes, así que aguanta salas grandes.
 * - `mesh`: cada participante abre una conexión con cada uno de los demás. El
 *   audio va directo, sin servidor, con menos latencia, pero el coste de subida
 *   crece con la sala. Es la reserva cuando el SFU no está disponible.
 *
 * El cliente no elige: se adapta a lo que diga el servidor, porque una sala
 * mixta quedaría sorda (quien espera ofertas no las recibe y quien espera
 * productores tampoco).
 */
export function VoiceRoomProvider({ children }) {
  const { user } = useAuth();
  const { emit, emitAck, subscribe, connected } = useSocket();

  const [room, setRoom] = useState(null); // { room, slug, name }
  const [mode, setMode] = useState(null); // 'sfu' | 'mesh'
  const [peers, setPeers] = useState([]); // [{ id, username, muted }]
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  // Se incrementa cuando entra un stream remoto nuevo, para que los elementos
  // de audio vuelvan a enganchar su `srcObject`.
  const [streamTick, setStreamTick] = useState(0);

  const localStreamRef = useRef(null);
  const pcsRef = useRef(new Map()); // peerId -> RTCPeerConnection (malla)
  const sfuRef = useRef(null); // cliente SFU activo
  const remoteStreamsRef = useRef(new Map()); // peerId -> MediaStream
  const pendingCandidatesRef = useRef(new Map()); // peerId -> RTCIceCandidateInit[]
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const roomRef = useRef(null);
  const modeRef = useRef(null);
  const mutedRef = useRef(false);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  // Configuración ICE una vez por sesión, igual que en las llamadas.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    api
      .get('/calls/ice')
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data?.iceServers) || !data.iceServers.length) return;
        iceServersRef.current = data.iceServers;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  const teardownPeer = useCallback((peerId) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) {
      pc.close();
      pcsRef.current.delete(peerId);
    }
    remoteStreamsRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);
    setPeers((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  const cleanup = useCallback(() => {
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    sfuRef.current?.close();
    sfuRef.current = null;
    remoteStreamsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    roomRef.current = null;
    modeRef.current = null;
    setRoom(null);
    setMode(null);
    setPeers([]);
    setMuted(false);
    mutedRef.current = false;
    setConnecting(false);
  }, []);

  // Un audio remoto llegó. Se agrupa por participante: en SFU cada uno manda su
  // propia pista, así que se crea un MediaStream por persona. Así la barra puede
  // pintar un `<audio>` por participante igual que en malla.
  const attachRemoteTrack = useCallback((track, peerId) => {
    const key = String(peerId);
    const existing = remoteStreamsRef.current.get(key);
    if (existing) {
      existing.addTrack(track);
    } else {
      remoteStreamsRef.current.set(key, new MediaStream([track]));
    }
    setStreamTick((n) => n + 1);
  }, []);

  // ------------------------------------------------------------------
  // Malla: conexión directa con cada participante
  // ------------------------------------------------------------------

  const createPeer = useCallback(
    (peerId) => {
      const existing = pcsRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcsRef.current.set(peerId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emit('voice:ice', { to: peerId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        remoteStreamsRef.current.set(peerId, stream);
        setStreamTick((n) => n + 1);
      };

      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) {
          teardownPeer(peerId);
        }
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      return pc;
    },
    [emit, teardownPeer]
  );

  // Quien entra ofrece a cada uno de los que ya estaban.
  const offerTo = useCallback(
    async (peerId) => {
      try {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emit('voice:offer', { to: peerId, sdp: pc.localDescription });
      } catch (err) {
        setError(`No se pudo conectar con un participante: ${err.message}`);
        teardownPeer(peerId);
      }
    },
    [createPeer, emit, teardownPeer]
  );

  // ------------------------------------------------------------------
  // SFU: publicar el micrófono y suscribirse a los demás
  // ------------------------------------------------------------------

  const startSfu = useCallback(
    async ({ routerRtpCapabilities, producers }) => {
      // Importación dinámica: mediasoup-client pesa, y quien nunca entra a una
      // sala de voz no debería descargarlo. Si el import falla, el error sube y
      // el contexto lo muestra en lugar de fingir que se oye.
      const { createSfuClient } = await import('../lib/sfuClient');
      const client = await createSfuClient({
        emitAck,
        localStream: localStreamRef.current,
        routerRtpCapabilities,
        iceServers: iceServersRef.current,
        userId: user?.id,
        onRemoteTrack: attachRemoteTrack,
      });
      sfuRef.current = client;
      // Los micrófonos que ya estaban sonando cuando entramos.
      await client.consumeExisting(producers || []);
    },
    [emitAck, user, attachRemoteTrack]
  );

  const join = useCallback(
    async ({ slug, name, mesh = false } = {}) => {
      if (!slug) return;
      if (!connectedRef.current) {
        setError('Sin conexión: espera un momento y vuelve a intentarlo');
        return;
      }

      setError('');
      setConnecting(true);
      // El gesto de pulsar "Entrar" es lo que desbloquea el audio del navegador.
      unlockAudio();

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Tu navegador no permite la sala de voz');
        }
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        roomRef.current = { slug, name };
        emit('voice:join', { slug, mesh });
      } catch {
        setError('No se pudo acceder al micrófono');
        cleanup();
      }
    },
    [cleanup, emit]
  );

  const leave = useCallback(() => {
    if (roomRef.current) emit('voice:leave', {});
    cleanup();
  }, [cleanup, emit]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    mutedRef.current = !track.enabled;
    setMuted(!track.enabled);
    emit('voice:mute', { muted: mutedRef.current });
  }, [emit]);

  // Señalización entrante.
  useEffect(() => {
    if (!user) return undefined;

    const unsubs = [
      subscribe(
        'voice:joined',
        async ({
          room: roomName,
          slug,
          name,
          mode: roomMode,
          routerRtpCapabilities,
          producers = [],
          peers: existing = [],
        }) => {
          setConnecting(false);
          setRoom({ room: roomName, slug, name });
          roomRef.current = { slug, name };
          modeRef.current = roomMode;
          setMode(roomMode);

          const others = existing
            .filter((p) => String(p.id) !== String(user.id))
            .map((p) => ({ id: String(p.id), username: p.username, muted: false }));
          setPeers(others);

          if (roomMode === 'sfu') {
            try {
              await startSfu({ routerRtpCapabilities, producers });
            } catch {
              // El SFU falló al montar el cliente (navegador sin soporte, worker
              // caído). Se avisa en vez de fingir que se oye.
              setError('No se pudo conectar el audio de la sala');
            }
          } else {
            // En malla, quien entra ofrece a cada uno de los presentes.
            others.forEach((p) => offerTo(p.id));
          }
        }
      ),

      // Alguien entra después que nosotros.
      subscribe('voice:peer-joined', ({ id, username }) => {
        if (!roomRef.current) return;
        if (String(id) === String(user.id)) return;
        setPeers((prev) =>
          prev.some((p) => p.id === String(id))
            ? prev
            : [...prev, { id: String(id), username, muted: false }]
        );
        // En malla no hacemos nada: él nos ofrecerá. En SFU tampoco: cuando
        // publique su micrófono llegará `voice:new-producer`.
      }),

      // En SFU, alguien acaba de publicar su micrófono: nos suscribimos.
      subscribe('voice:new-producer', ({ producerId, userId: owner }) => {
        if (modeRef.current !== 'sfu' || !roomRef.current) return;
        if (String(owner) === String(user.id)) return;
        sfuRef.current?.consume(producerId, String(owner)).catch(() => {});
      }),

      // --- Señalización de malla ---
      subscribe('voice:offer', async ({ from, sdp }) => {
        if (modeRef.current !== 'mesh' || !roomRef.current) return;
        try {
          const pc = createPeer(String(from));
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));

          for (const candidate of pendingCandidatesRef.current.get(String(from)) || []) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current.delete(String(from));

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emit('voice:answer', { to: String(from), sdp: pc.localDescription });
        } catch (err) {
          setError(`No se pudo contestar a un participante: ${err.message}`);
          teardownPeer(String(from));
        }
      }),

      subscribe('voice:answer', async ({ from, sdp }) => {
        const pc = pcsRef.current.get(String(from));
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          for (const candidate of pendingCandidatesRef.current.get(String(from)) || []) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current.delete(String(from));
        } catch (err) {
          setError(`No se pudo completar la conexión: ${err.message}`);
        }
      }),

      subscribe('voice:ice', async ({ from, candidate }) => {
        if (!candidate) return;
        const key = String(from);
        const pc = pcsRef.current.get(key);
        // Si aún no hay descripción remota, se guarda para aplicarlo después.
        if (!pc?.remoteDescription) {
          const list = pendingCandidatesRef.current.get(key) || [];
          list.push(candidate);
          pendingCandidatesRef.current.set(key, list);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Un candidato suelto que falla no invalida la conexión.
        }
      }),

      subscribe('voice:peer-left', ({ userId }) => {
        teardownPeer(String(userId));
      }),

      subscribe('voice:peer-mute', ({ userId, muted: peerMuted }) => {
        setPeers((prev) =>
          prev.map((p) => (p.id === String(userId) ? { ...p, muted: !!peerMuted } : p))
        );
      }),

      subscribe('voice:left', () => {
        cleanup();
      }),

      subscribe('voice:error', ({ error: message }) => {
        setError(message || 'No se pudo entrar en la sala de voz');
        cleanup();
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [user, subscribe, emit, startSfu, offerTo, createPeer, teardownPeer, cleanup]);

  // Al desmontar no debe quedar el micrófono abierto.
  useEffect(() => () => cleanup(), [cleanup]);

  const value = useMemo(
    () => ({
      room,
      mode,
      peers,
      muted,
      connecting,
      error,
      streamTick,
      active: !!room,
      join,
      leave,
      toggleMute,
      remoteStreamsRef,
      localStreamRef,
    }),
    [room, mode, peers, muted, connecting, error, streamTick, join, leave, toggleMute]
  );

  return <VoiceRoomContext.Provider value={value}>{children}</VoiceRoomContext.Provider>;
}

export function useVoiceRoom() {
  const ctx = useContext(VoiceRoomContext);
  if (!ctx) throw new Error('useVoiceRoom debe usarse dentro de VoiceRoomProvider');
  return ctx;
}

