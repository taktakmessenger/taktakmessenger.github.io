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
import { mediaErrorMessage } from '../lib/mediaErrors';

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
  const [peers, setPeers] = useState([]); // [{ id, username, muted, cameraOff }]
  const [hostId, setHostId] = useState(null); // dueño del creator: su ventana es mayor
  const [guestLimit, setGuestLimit] = useState(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  // Vista a pantalla completa del directo. Se abre al entrar (como TikTok: al
  // entrar a un directo lo ves a pantalla completa) y se cierra al minimizar,
  // que deja la barra flotante. La sala y el audio siguen igual en los dos
  // estados; solo cambia lo que se pinta.
  const [stageOpen, setStageOpen] = useState(false);
  // Se incrementa cuando entra un stream remoto nuevo, para que los elementos
  // de audio y vídeo vuelvan a enganchar su `srcObject`.
  const [streamTick, setStreamTick] = useState(0);

  const localStreamRef = useRef(null);
  const pcsRef = useRef(new Map()); // peerId -> RTCPeerConnection (malla)
  const sfuRef = useRef(null); // cliente SFU activo
  // El audio y el vídeo de cada par se guardan por separado. En un directo con
  // muchos invitados el vídeo se pinta en su ventana y el audio en un `<audio>`
  // oculto; mezclarlos en un solo MediaStream obligaría a cada elemento a
  // filtrar pistas y a los dos a pelearse por el mismo objeto.
  const remoteStreamsRef = useRef(new Map()); // peerId -> MediaStream (audio)
  const remoteVideoStreamsRef = useRef(new Map()); // peerId -> MediaStream (vídeo)
  const pendingCandidatesRef = useRef(new Map()); // peerId -> RTCIceCandidateInit[]
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const roomRef = useRef(null);
  const modeRef = useRef(null);
  const mutedRef = useRef(false);
  const camOffRef = useRef(false);
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
    remoteVideoStreamsRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);
    setPeers((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  const cleanup = useCallback(() => {
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    sfuRef.current?.close();
    sfuRef.current = null;
    remoteStreamsRef.current.clear();
    remoteVideoStreamsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    roomRef.current = null;
    modeRef.current = null;
    setRoom(null);
    setMode(null);
    setHostId(null);
    setGuestLimit(null);
    setPeers([]);
    setMuted(false);
    setCamOff(false);
    mutedRef.current = false;
    camOffRef.current = false;
    setStageOpen(false);
    setConnecting(false);
  }, []);

  // Un flujo remoto llegó. Se agrupa por participante y por tipo: en SFU cada
  // pista es su propio productor, así que un mismo par puede tener audio y
  // vídeo a la vez. El audio va a `remoteStreamsRef` (un `<audio>` oculto por
  // persona) y el vídeo a `remoteVideoStreamsRef` (su ventana en la rejilla).
  const attachRemoteTrack = useCallback((track, peerId, kind) => {
    const key = String(peerId);
    const map = kind === 'video' ? remoteVideoStreamsRef : remoteStreamsRef;
    const existing = map.current.get(key);
    if (existing) {
      existing.addTrack(track);
    } else {
      map.current.set(key, new MediaStream([track]));
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
        const track = event.track;
        // En malla el par manda audio y vídeo por el mismo enlace, y `streams[0]`
        // trae las dos pistas. Se separan a propósito en streams por tipo: si el
        // `<video>` recibiera el stream completo, reproduciría también el audio
        // y se oiría dos veces.
        attachRemoteTrack(track, peerId, track.kind);
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
    [emit, teardownPeer, attachRemoteTrack]
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
          throw new Error('Tu navegador no permite el directo');
        }
        // El directo lleva cámara y voz. Si la cámara falla (permiso denegado
        // solo para ella, o no hay ninguna), se entra igual como oyente con
        // micrófono en vez de dejar al usuario fuera: es más útil estar en la
        // sala hablando que no estar.
        try {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          });
        } catch (videoErr) {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          camOffRef.current = true;
          setCamOff(true);
          setError('Sin cámara: entras solo con voz');
          // El aviso se borra solo; no debe quedar tapando el directo.
          setTimeout(() => setError(''), 4000);
        }
        roomRef.current = { slug, name };
        emit('voice:join', { slug, mesh });
      } catch (err) {
        setError(err?.message || mediaErrorMessage(err));
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

  // Encender o apagar la cámara. Se desactiva la pista en vez de pararla: parar
  // la pista cerraría el productor y para volver a encenderla habría que crear
  // otro, con el parpadeo de renegociación que eso conlleva. Desactivándola, el
  // flujo sigue publicado (negro) y el aviso a los demás les dice que muestren
  // el avatar.
  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    camOffRef.current = !track.enabled;
    setCamOff(!track.enabled);
    emit('voice:camera', { off: camOffRef.current });
  }, [emit]);

  // Abrir o cerrar la vista a pantalla completa del directo. No toca la sala ni
  // el audio: solo cambia si se pinta la rejilla entera o la barra flotante.
  const toggleStage = useCallback(() => setStageOpen((open) => !open), []);

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
          hostId: roomHostId,
          guestLimit: limit,
          routerRtpCapabilities,
          producers = [],
          peers: existing = [],
        }) => {
          setConnecting(false);
          setRoom({ room: roomName, slug, name });
          roomRef.current = { slug, name };
          modeRef.current = roomMode;
          setMode(roomMode);
          setHostId(roomHostId ? String(roomHostId) : null);
          setGuestLimit(Number.isFinite(limit) ? limit : null);
          // Entrar al directo lo abre a pantalla completa; desde ahí se puede
          // minimizar a la barra para seguir en el feed.
          setStageOpen(true);

          const others = existing
            .filter((p) => String(p.id) !== String(user.id))
            .map((p) => ({ id: String(p.id), username: p.username, muted: false, cameraOff: false }));
          setPeers(others);

          if (roomMode === 'sfu') {
            try {
              await startSfu({ routerRtpCapabilities, producers });
            } catch {
              // El SFU falló al montar el cliente (navegador sin soporte, worker
              // caído). Se avisa en vez de fingir que se ve y se oye.
              setError('No se pudo conectar el audio y el vídeo de la sala');
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
            : [...prev, { id: String(id), username, muted: false, cameraOff: false }]
        );
        // En malla no hacemos nada: él nos ofrecerá. En SFU tampoco: cuando
        // publique su micrófono o su cámara llegará `voice:new-producer`.
      }),

      // En SFU, alguien acaba de publicar un flujo: nos suscribimos.
      subscribe('voice:new-producer', ({ producerId, userId: owner, kind }) => {
        if (modeRef.current !== 'sfu' || !roomRef.current) return;
        if (String(owner) === String(user.id)) return;
        sfuRef.current?.consume(producerId, String(owner), kind).catch(() => {});
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

      subscribe('voice:peer-camera', ({ userId, off }) => {
        setPeers((prev) =>
          prev.map((p) => (p.id === String(userId) ? { ...p, cameraOff: !!off } : p))
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
      hostId,
      guestLimit,
      muted,
      camOff,
      connecting,
      error,
      streamTick,
      stageOpen,
      active: !!room,
      join,
      leave,
      toggleMute,
      toggleCamera,
      toggleStage,
      remoteStreamsRef,
      remoteVideoStreamsRef,
      localStreamRef,
    }),
    [
      room,
      mode,
      peers,
      hostId,
      guestLimit,
      muted,
      camOff,
      connecting,
      error,
      streamTick,
      stageOpen,
      join,
      leave,
      toggleMute,
      toggleCamera,
      toggleStage,
    ]
  );

  return <VoiceRoomContext.Provider value={value}>{children}</VoiceRoomContext.Provider>;
}

export function useVoiceRoom() {
  const ctx = useContext(VoiceRoomContext);
  if (!ctx) throw new Error('useVoiceRoom debe usarse dentro de VoiceRoomProvider');
  return ctx;
}

