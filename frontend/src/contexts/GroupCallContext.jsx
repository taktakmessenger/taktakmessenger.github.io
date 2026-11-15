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
import { useCall } from './CallContext';
import { useSocket } from './SocketContext';
import { startRingtone, stopRingtone, unlockAudio } from '../lib/ringtone';
import { applyAudioSession } from '../lib/sound';
import { mediaErrorMessage } from '../lib/mediaErrors';
import { GROUP_CALL_MAX, normalizeInvitees } from '../lib/groupCall';

const GroupCallContext = createContext(null);

// Mismos STUN por defecto que la llamada 1 a 1 y la sala de voz. La lista real
// llega de `/calls/ice`, que puede incluir TURN.
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export { GROUP_CALL_MAX };

const IDLE = 'idle';

/**
 * Llamada grupal ad-hoc de WhaTaka.
 *
 * Es una malla WebRTC: cada participante abre una conexión directa con cada uno
 * de los demás, igual que la sala de voz del directo. El servidor solo reparte
 * las invitaciones, lleva la lista de quién está dentro y reenvía la
 * señalización (oferta, respuesta, ICE); el audio y el vídeo van de persona a
 * persona y nunca pasan por él.
 *
 * Por eso el tope es de cuatro: en malla cada uno sube su audio y su vídeo a
 * cada uno de los demás, así que el coste de subida crece con la sala. Cuatro es
 * lo que sostiene bien una conexión móvil normal.
 *
 * Estados:
 * - `outgoing`: el anfitrión invitó y espera a que alguien acepte.
 * - `incoming`: me invitaron y aún no he decidido.
 * - `active`: hay una llamada en curso (aunque sea solo yo, si los demás
 *   colgaron y quedo yo dentro).
 */
export function GroupCallProvider({ children }) {
  const { user } = useAuth();
  const { emit, subscribe, connected } = useSocket();
  // Una llamada 1 a 1 y una grupal no pueden convivir: comparten micrófono y
  // altavoz, y dos timbres a la vez serían un caos. Si hay una 1 a 1 en curso,
  // la grupal no suena y se rechaza sola.
  const { status: oneToOneStatus } = useCall();
  const oneToOneActiveRef = useRef(false);
  oneToOneActiveRef.current = oneToOneStatus && oneToOneStatus !== 'idle';

  const [status, setStatus] = useState(IDLE);
  const [kind, setKind] = useState('video');
  const [callId, setCallId] = useState(null);
  const [hostId, setHostId] = useState(null);
  // La invitación que aún no se ha aceptado ni rechazado.
  const [incoming, setIncoming] = useState(null);
  // Quién está en la llamada, según el servidor. Es la fuente de verdad de la
  // rejilla: incluye a quien aún no ha negociado medios.
  const [members, setMembers] = useState([]);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Se incrementa cuando entra un stream remoto nuevo, para que los elementos
  // de vídeo y audio vuelvan a engancharlo.
  const [streamTick, setStreamTick] = useState(0);

  const localStreamRef = useRef(null);
  const pcsRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const remoteStreamsRef = useRef(new Map()); // peerId -> MediaStream (audio)
  const remoteVideoStreamsRef = useRef(new Map()); // peerId -> MediaStream (vídeo)
  const pendingCandidatesRef = useRef(new Map()); // peerId -> RTCIceCandidateInit[]
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const callIdRef = useRef(null);
  const statusRef = useRef(IDLE);
  const kindRef = useRef('video');
  const originRef = useRef('whataka');
  const mutedRef = useRef(false);
  const camOffRef = useRef(false);
  const ringTimeoutRef = useRef(null);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const selfId = user?.id || user?._id || null;

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

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const teardownPeer = useCallback((peerId) => {
    const key = String(peerId);
    const pc = pcsRef.current.get(key);
    if (pc) {
      pc.close();
      pcsRef.current.delete(key);
    }
    remoteStreamsRef.current.delete(key);
    remoteVideoStreamsRef.current.delete(key);
    pendingCandidatesRef.current.delete(key);
  }, []);

  const cleanup = useCallback(() => {
    clearRingTimeout();
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    remoteStreamsRef.current.clear();
    remoteVideoStreamsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    callIdRef.current = null;
    statusRef.current = IDLE;
    mutedRef.current = false;
    camOffRef.current = false;
    applyAudioSession('auto');
    stopRingtone();
    setStatus(IDLE);
    setCallId(null);
    setHostId(null);
    setIncoming(null);
    setMembers([]);
    setMuted(false);
    setCamOff(false);
    setMinimized(false);
    setStreamTick(0);
  }, [clearRingTimeout]);

  const attachRemoteTrack = useCallback((track, peerId, trackKind) => {
    const key = String(peerId);
    const map = trackKind === 'video' ? remoteVideoStreamsRef : remoteStreamsRef;
    const existing = map.current.get(key);
    if (existing) existing.addTrack(track);
    else map.current.set(key, new MediaStream([track]));
    setStreamTick((n) => n + 1);
  }, []);

  const createPeer = useCallback(
    (peerId) => {
      const key = String(peerId);
      const existing = pcsRef.current.get(key);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcsRef.current.set(key, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emit('call:group-ice', { callId: callIdRef.current, to: key, candidate: event.candidate });
        }
      };

      // Audio y vídeo se separan en streams por tipo: si el `<video>` recibiera
      // el stream completo, reproduciría también el audio y se oiría dos veces.
      pc.ontrack = (event) => attachRemoteTrack(event.track, key, event.track.kind);

      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) teardownPeer(key);
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      return pc;
    },
    [attachRemoteTrack, emit, teardownPeer]
  );

  // Quien entra ofrece a cada uno de los que ya estaban. Un único sentido de
  // negociación evita cruzar dos ofertas simultáneas.
  const offerTo = useCallback(
    async (peerId) => {
      try {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emit('call:group-offer', { callId: callIdRef.current, to: String(peerId), sdp: pc.localDescription });
      } catch (err) {
        setError(`No se pudo conectar con un participante: ${err.message}`);
        teardownPeer(peerId);
      }
    },
    [createPeer, emit, teardownPeer]
  );

  const acquireMedia = useCallback(async (callKind) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Tu navegador no permite llamadas');
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callKind === 'video' ? { facingMode: 'user' } : false,
      });
    } catch (err) {
      // En videollamada la cámara puede fallar y el micrófono no: se entra con
      // voz en vez de dejar sin llamada.
      if (callKind === 'video') {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          setNotice('Sin cámara: entras solo con voz');
          camOffRef.current = true;
          setCamOff(true);
          return audioOnly;
        } catch {
          throw new Error(mediaErrorMessage(err));
        }
      }
      throw new Error(mediaErrorMessage(err));
    }
  }, []);

  // El anfitrión llama: pide permiso, crea la llamada e invita.
  const startGroupCall = useCallback(
    async (invitees, callKind = 'video') => {
      const ids = normalizeInvitees(invitees, selfId);
      if (ids.length === 0) return;
      // Con una llamada 1 a 1 en curso no se puede empezar una grupal: el
      // micrófono y el altavoz ya están ocupados.
      if (oneToOneActiveRef.current) {
        setError('Estás en una llamada: cuélgala antes de empezar una grupal');
        return;
      }
      if (!connectedRef.current) {
        setError('Sin conexión: espera un momento y vuelve a intentarlo');
        return;
      }

      setError('');
      setNotice('');
      setKind(callKind);
      kindRef.current = callKind;
      originRef.current = 'whataka';
      setStatus('outgoing');
      statusRef.current = 'outgoing';
      unlockAudio();

      try {
        localStreamRef.current = await acquireMedia(callKind);
      } catch (err) {
        setError(err.message);
        cleanup();
        return;
      }

      setMembers([{ id: String(selfId), username: user?.username, host: true }]);
      emit('call:group-invite', { to: ids, kind: callKind, origin: 'whataka' });

      // Nadie contesta en 45 s: se cierra, como en la llamada 1 a 1.
      clearRingTimeout();
      ringTimeoutRef.current = setTimeout(() => {
        if (statusRef.current !== 'outgoing') return;
        if (callIdRef.current) emit('call:group-leave', { callId: callIdRef.current });
        cleanup();
        setNotice('Nadie contestó la llamada');
      }, 45000);
    },
    [acquireMedia, cleanup, clearRingTimeout, emit, selfId, user?.username]
  );

  // El invitado acepta: pide permiso y avisa. La negociación llega después, en
  // `call:group-joined`, porque hasta aquí no se ha entrado a la sala.
  const acceptGroupCall = useCallback(async () => {
    const pending = incoming;
    if (!pending) return;

    setError('');
    setStatus('active');
    statusRef.current = 'active';
    unlockAudio();
    stopRingtone();

    try {
      localStreamRef.current = await acquireMedia(pending.kind);
    } catch (err) {
      setError(err.message);
      setStatus('incoming');
      statusRef.current = 'incoming';
      return;
    }

    setKind(pending.kind);
    kindRef.current = pending.kind;
    originRef.current = pending.origin || 'whataka';
    callIdRef.current = pending.callId;
    setCallId(pending.callId);
    setHostId(pending.from?.id || null);
    setIncoming(null);

    if (!connectedRef.current) {
      setError('Sin conexión: no se pudo aceptar la llamada');
      cleanup();
      return;
    }
    emit('call:group-accept', { callId: pending.callId });
  }, [cleanup, incoming, acquireMedia, emit]);

  const rejectGroupCall = useCallback(() => {
    if (incoming?.callId) emit('call:group-reject', { callId: incoming.callId });
    cleanup();
  }, [cleanup, emit, incoming]);

  const hangUp = useCallback(() => {
    if (callIdRef.current) emit('call:group-leave', { callId: callIdRef.current });
    cleanup();
  }, [cleanup, emit]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    mutedRef.current = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    camOffRef.current = !track.enabled;
    setCamOff(!track.enabled);
  }, []);

  const toggleMinimize = useCallback(() => setMinimized((v) => !v), []);

  // Timbre: suena mientras me están llamando o mientras espero a que alguien
  // coja. Se para solo al pasar a activa o al cerrarse.
  useEffect(() => {
    if (status === 'incoming') {
      startRingtone('incoming', user?.callRingtoneId);
      return () => stopRingtone();
    }
    if (status === 'outgoing') {
      startRingtone('outgoing');
      return () => stopRingtone();
    }
    stopRingtone();
    return undefined;
  }, [status, user?.callRingtoneId]);

  // Mientras la llamada está viva se declara la sesión como llamada, para que
  // el móvil trate el audio como tal y no lo corte en segundo plano.
  useEffect(() => {
    if (status === 'active') applyAudioSession('play-and-record');
  }, [status]);

  useEffect(() => {
    if (!user) return undefined;

    const unsubs = [
      subscribe('call:group-incoming', (payload) => {
        // Ya en una llamada grupal: no se puede atender otra. Se rechaza sola
        // para no dejar al otro timbrando.
        if (statusRef.current !== IDLE && statusRef.current !== 'incoming') {
          emit('call:group-reject', { callId: payload.callId });
          return;
        }
        // Con una llamada 1 a 1 en curso tampoco: no pueden sonar dos a la vez.
        if (oneToOneActiveRef.current) {
          emit('call:group-reject', { callId: payload.callId });
          return;
        }
        setIncoming(payload);
        setKind(payload.kind);
        kindRef.current = payload.kind;
        setStatus('incoming');
        statusRef.current = 'incoming';
      }),

      // El servidor confirmó la invitación: aquí llega el `callId` que el
      // anfitrión necesita para todo lo demás.
      subscribe('call:group-ringing', ({ callId: id, reachable }) => {
        callIdRef.current = id;
        setCallId(id);
        if (reachable === 0) {
          setNotice('Nadie disponible: nadie de los invitados tiene la app abierta');
          cleanup();
        }
      }),

      // Me aceptaron y ya estoy dentro: conecto con los que estaban.
      subscribe('call:group-joined', async ({ callId: id, kind: callKind, hostId: hId, peers = [], members: roster = [] }) => {
        callIdRef.current = id;
        setCallId(id);
        setHostId(hId);
        setKind(callKind);
        kindRef.current = callKind;
        setMembers(roster);
        setStatus('active');
        statusRef.current = 'active';
        clearRingTimeout();
        stopRingtone();
        for (const peer of peers) {
          // eslint-disable-next-line no-await-in-loop
          await offerTo(peer.id);
        }
      }),

      // Alguien entró a la llamada. Yo ya estaba, así que no llamo: espero su
      // oferta. Solo actualizo el estado por si era el primero que aceptaba.
      subscribe('call:group-peer-joined', () => {
        if (statusRef.current === 'outgoing') {
          statusRef.current = 'active';
          setStatus('active');
          clearRingTimeout();
          stopRingtone();
        }
      }),

      subscribe('call:group-members', ({ members: roster = [] }) => setMembers(roster)),

      subscribe('call:group-left', ({ userId }) => teardownPeer(userId)),

      subscribe('call:group-rejected', ({ from }) => {
        setMembers((prev) => prev.filter((m) => String(m.id) !== String(from)));
      }),

      subscribe('call:group-ended', () => {
        cleanup();
        setNotice('La llamada ha terminado');
      }),

      subscribe('call:group-error', ({ error: message }) => {
        setError(message || 'No se pudo completar la llamada');
        cleanup();
      }),

      subscribe('call:group-offer', async ({ from, sdp }) => {
        try {
          const pc = createPeer(from);
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const buffered = pendingCandidatesRef.current.get(String(from)) || [];
          for (const candidate of buffered) {
            // eslint-disable-next-line no-await-in-loop
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current.delete(String(from));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emit('call:group-answer', { callId: callIdRef.current, to: String(from), sdp: pc.localDescription });
        } catch (err) {
          setError(`No se pudo aceptar la conexión: ${err.message}`);
        }
      }),

      subscribe('call:group-answer', async ({ from, sdp }) => {
        const pc = pcsRef.current.get(String(from));
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (err) {
          setError(`No se pudo conectar: ${err.message}`);
        }
      }),

      subscribe('call:group-ice', async ({ from, candidate }) => {
        const key = String(from);
        const pc = pcsRef.current.get(key);
        if (!pc || !pc.remoteDescription) {
          const buffered = pendingCandidatesRef.current.get(key) || [];
          buffered.push(candidate);
          pendingCandidatesRef.current.set(key, buffered);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Un candidato que llega tarde no debe tumbar la conexión.
        }
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub?.());
  }, [user, subscribe, emit, cleanup, clearRingTimeout, createPeer, offerTo, teardownPeer]);

  useEffect(() => () => cleanup(), [cleanup]);

  const value = useMemo(
    () => ({
      status,
      kind,
      callId,
      hostId,
      selfId,
      incoming,
      members,
      muted,
      camOff,
      minimized,
      error,
      notice,
      streamTick,
      active: status !== IDLE,
      startGroupCall,
      acceptGroupCall,
      rejectGroupCall,
      hangUp,
      toggleMute,
      toggleCamera,
      toggleMinimize,
      remoteStreamsRef,
      remoteVideoStreamsRef,
      localStreamRef,
    }),
    [
      status,
      kind,
      callId,
      hostId,
      selfId,
      incoming,
      members,
      muted,
      camOff,
      minimized,
      error,
      notice,
      streamTick,
      startGroupCall,
      acceptGroupCall,
      rejectGroupCall,
      hangUp,
      toggleMute,
      toggleCamera,
      toggleMinimize,
    ]
  );

  return <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>;
}

export function useGroupCall() {
  const ctx = useContext(GroupCallContext);
  if (!ctx) throw new Error('useGroupCall debe usarse dentro de GroupCallProvider');
  return ctx;
}
