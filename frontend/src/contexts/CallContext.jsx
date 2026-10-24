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
import { startRingtone, stopRingtone, unlockAudio } from '../lib/ringtone';

const CallContext = createContext(null);

// Servidores ICE por defecto, mientras llega la lista del servidor. Los públicos
// bastan para descubrir la dirección propia y probar en local; para cruzar NAT
// estricto hace falta un TURN, que se configura en el backend y llega por
// `/api/calls/ice` (ver `loadIceServers`).
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const IDLE = 'idle';

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { emit, subscribe, connected } = useSocket();

  const [status, setStatus] = useState(IDLE);
  const [kind, setKind] = useState('audio');
  const [peer, setPeer] = useState(null);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  // Una llamada minimizada sigue activa pero deja ver el resto de la app, para
  // no perder el vídeo que se estaba viendo. Solo tiene sentido una vez
  // contestada: una llamada entrante sin aceptar debe verse entera.
  const [minimized, setMinimized] = useState(false);
  // Aviso informativo, distinto de `error`: no indica que algo haya fallado,
  // sino una limitación conocida (por ejemplo, llamadas sin TURN). Se muestra
  // en tono neutro para no alarmar.
  const [notice, setNotice] = useState('');
  // Se incrementa cuando hay un stream remoto nuevo, para que la pantalla de
  // llamada vuelva a engancharlo.
  const [remoteTick, setRemoteTick] = useState(0);

  // Lista ICE vigente. Empieza con los STUN públicos y se sustituye por la del
  // servidor, que puede incluir TURN. Se guarda en un ref además de en estado
  // porque `createPeerConnection` la lee al construir la conexión y no debe
  // depender de que el componente se haya vuelto a renderizar.
  const [iceServers, setIceServers] = useState(DEFAULT_ICE_SERVERS);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  // Aviso de que las llamadas pueden cortarse fuera de la red local por falta de
  // TURN. Se muestra una sola vez, en el primer intento de llamada.
  const turnWarningShownRef = useRef(false);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingCandidates = useRef([]);
  // La llamada entrante se guarda aquí hasta que el usuario acepta: no se puede
  // montar la conexión antes, o la llamada sonaría sin permiso.
  const pendingOfferRef = useRef(null);
  const peerIdRef = useRef(null);
  const statusRef = useRef(IDLE);
  // `finalize` se ejecuta desde manejadores de socket creados una sola vez, que
  // capturan el `kind` del primer render; el ref siempre da el valor vigente.
  const kindRef = useRef('audio');
  // Solo quien inicia la llamada escribe la entrada del hilo. Si lo hicieran los
  // dos, cada llamada aparecería duplicada en el historial.
  const isCallerRef = useRef(false);
  // Temporizador de timbrado: si nadie contesta en unos segundos, la llamada
  // queda como perdida y se cuelga sola, igual que en WhatsApp.
  const ringTimeoutRef = useRef(null);
  // Cierre de la llamada en curso. Se guarda en un ref para que los manejadores
  // de socket (creados una sola vez) puedan invocarlo sin re-suscribirse.
  const finalizeRef = useRef(null);

  statusRef.current = status;

  // El socket puede tardar un instante en conectar al abrir la app. Si se llama
  // en ese hueco, la invitación se perdería sin aviso y la pantalla mostraría
  // "Llamando…" para siempre. Se guarda el estado en un ref para leerlo desde
  // `startCall` sin recrear la función en cada reconexión.
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  // Si la lista ICE vigente incluye TURN. Se deriva del estado y no de una
  // variable suelta para que se recalcule cuando llega la configuración del
  // servidor.
  const hasTurn = useMemo(
    () =>
      iceServers.some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => typeof url === 'string' && url.startsWith('turn'));
      }),
    [iceServers]
  );

  // Trae la configuración ICE del servidor al iniciar sesión. Se pide una sola
  // vez por sesión: los servidores ICE no cambian a mitad de uso, y pedirlo en
  // cada llamada añadiría una ida y vuelta justo antes de marcar.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    api
      .get('/calls/ice')
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data?.iceServers) || data.iceServers.length === 0) {
          return;
        }
        iceServersRef.current = data.iceServers;
        setIceServers(data.iceServers);
      })
      .catch(() => {
        // Sin respuesta se mantienen los STUN por defecto: la llamada en la
        // misma red sigue funcionando.
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // El audio del navegador está bloqueado hasta que la persona toca la página.
  // El tono de llamada es sonido generado, así que sin este desbloqueo sonaría
  // mudo justo cuando más falta hace oírlo. Se engancha una sola vez y se quita
  // en el primer gesto; a partir de ahí el contexto queda activo.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Tono y vibración mientras la llamada timbra. Suena en 'incoming' (alguien
  // llama) y en 'ringing' (estamos llamando), y para en cuanto la llamada se
  // contesta, se rechaza o se cuelga: cualquier otro estado apaga el timbre.
  useEffect(() => {
    if (status === 'incoming') {
      startRingtone('incoming');
      return;
    }
    if (status === 'ringing') {
      startRingtone('outgoing');
      return;
    }
    stopRingtone();
  }, [status]);

  // Al desmontar no debe quedar un tono sonando para siempre.
  useEffect(() => () => stopRingtone(), []);

  // Momento en que la llamada pasó a estar activa, para calcular su duración
  // real. Se guarda en un ref y no en estado porque solo se lee al colgar.
  const activeSinceRef = useRef(null);
  // Evita registrar dos veces el mismo final: `hangUp` y `call:ended` pueden
  // dispararse los dos (quien cuelga y quien recibe el aviso).
  const loggedRef = useRef(false);

  // Deja la llamada en el hilo, como WhatsApp. Se envía el resultado tal como
  // acabó y el servidor lo guarda junto a los mensajes.
  //
  // Es "best effort": si falla, la llamada ya terminó y no tiene sentido
  // molestar al usuario con un error de historial.
  const logCall = useCallback(
    (peerId, callKind, callStatus, durationSeconds = 0) => {
      if (!peerId) return;

      api
        .post('/messages/calls', {
          peerId,
          kind: callKind,
          status: callStatus,
          durationSeconds,
        })
        .catch(() => {});
    },
    []
  );

  // Cancela el temporizador de timbrado, si lo hubiera.
  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearRingTimeout();

    pcRef.current?.close();
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    remoteStreamRef.current = null;
    pendingCandidates.current = [];
    pendingOfferRef.current = null;
    peerIdRef.current = null;
    activeSinceRef.current = null;
    isCallerRef.current = false;
    loggedRef.current = false;

    setStatus(IDLE);
    setPeer(null);
    setMuted(false);
    setCamOff(false);
    setNotice('');
    // Si no se restaurase, la siguiente llamada nacería minimizada.
    setMinimized(false);
  }, [clearRingTimeout]);

  // Duración transcurrida desde que la llamada quedó activa. 0 si nunca llegó a
  // contestarse, que es lo que el servidor espera para una llamada no atendida.
  const callDuration = useCallback(() => {
    if (!activeSinceRef.current) return 0;
    return Math.max(0, Math.round((Date.now() - activeSinceRef.current) / 1000));
  }, []);

  // Cierra la llamada y la deja registrada en el hilo una sola vez.
  //
  // Es el único punto que escribe el historial: lo llaman colgar, rechazar, el
  // fin remoto y el temporizador de timbrado, así que una misma llamada no puede
  // aparecer dos veces. `loggedRef` se rearma en `cleanup`, que se ejecuta al
  // final, de modo que la siguiente llamada sí se registra.
  const finalize = useCallback(
    (finalStatus) => {
      const peerId = peerIdRef.current;
      const callKind = kindRef.current;

      // Solo escribe el llamante: el hilo es compartido, así que una entrada
      // basta y los dos participantes la ven.
      if (isCallerRef.current && peerId && !loggedRef.current) {
        loggedRef.current = true;
        logCall(peerId, callKind, finalStatus, callDuration());
      }

      cleanup();
    },
    [callDuration, cleanup, logCall]
  );

  finalizeRef.current = finalize;

  const fail = useCallback(
    (message) => {
      setError(message);
      finalize(activeSinceRef.current ? 'answered' : 'missed');
    },
    [finalize]
  );

  const createPeerConnection = useCallback(
    (to) => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

      pc.onicecandidate = (event) => {
        if (event.candidate) emit('call:ice', { to, candidate: event.candidate });
      };

      pc.ontrack = (event) => {
        remoteStreamRef.current = event.streams[0];
        setRemoteTick((n) => n + 1);
      };

      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(pc.connectionState)) {
          if (statusRef.current !== IDLE) fail('La llamada se ha cortado');
        }
      };

      // Las pistas locales se añaden aquí, una sola vez, tanto si llamamos como
      // si respondemos: si el stream no está listo todavía, el llamante lo
      // añade al recibir el permiso.
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      pcRef.current = pc;
      return pc;
    },
    [emit, fail]
  );

  // Pide cámara y/o micrófono. Si la cámara falla, la llamada sigue como voz en
  // lugar de abortar.
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
      if (callKind === 'video') {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        setError('Sin cámara: la llamada sigue solo con voz');
        return audioOnly;
      }
      throw new Error('No se pudo acceder al micrófono');
    }
  }, []);

  // Quien llama: pide permiso, invita y espera. La oferta NO se envía todavía:
  // se manda cuando el otro acepta, para que nadie reciba medios sin decidir.
  const startCall = useCallback(
    async (target, callKind = 'audio') => {
      if (!target?.id) return;

      // Sin conexión no se puede invitar a nadie. Se avisa en vez de fingir que
      // se está llamando.
      if (!connectedRef.current) {
        setError('Sin conexión: espera un momento y vuelve a intentarlo');
        return;
      }

      setError('');
      setNotice('');

      // Si no hay TURN configurado, la llamada solo cruzará redes sencillas. Se
      // avisa al empezar y no después de fallar: el usuario decide si llamar
      // igualmente, en lugar de descubrir el límite cuando ya se ha cortado.
      if (!hasTurn && !turnWarningShownRef.current) {
        turnWarningShownRef.current = true;
        setNotice(
          'Sin servidor TURN configurado: la llamada puede cortarse fuera de tu red local'
        );
      }

      setKind(callKind);
      kindRef.current = callKind;
      setPeer(target);
      peerIdRef.current = target.id;
      setStatus('preparing');

      try {
        localStreamRef.current = await acquireMedia(callKind);
        // Se marca como llamante justo antes de invitar, no al empezar: si el
        // usuario deniega el micrófono, no llegó a existir llamada y no debe
        // quedar una "perdida" en el historial.
        isCallerRef.current = true;
        emit('call:invite', { to: target.id, kind: callKind });
        setStatus('ringing');

        // Nadie contesta en 45 s: se cuelga y queda como perdida, como en
        // WhatsApp. Sin esto el llamante se quedaría timbrando para siempre.
        clearRingTimeout();
        ringTimeoutRef.current = setTimeout(() => {
          if (statusRef.current !== 'ringing') return;
          emit('call:end', { to: target.id });
          finalizeRef.current?.('missed');
        }, 45000);
      } catch (err) {
        fail(err.message);
      }
    },
    [acquireMedia, clearRingTimeout, emit, fail, hasTurn]
  );

  // Responde a la oferta: monta la conexión, contesta y queda activa. Se usa
  // tanto si la oferta llegó antes de aceptar como si llega después.
  const answerOffer = useCallback(
    async (target, offer) => {
      // Una segunda oferta no debe montar una conexión nueva: ya hay una
      // negociación en marcha y dos `RTCPeerConnection` competirían por el mismo
      // stream remoto.
      if (pcRef.current) return;

      try {
        const pc = createPeerConnection(target);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        for (const candidate of pendingCandidates.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidates.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        emit('call:answer', { to: target, sdp: pc.localDescription });
        // Desde aquí cuenta la duración que se guarda en el historial.
        activeSinceRef.current = Date.now();
        setStatus('active');
      } catch (err) {
        fail(`No se pudo aceptar la llamada: ${err.message}`);
      }
    },
    [createPeerConnection, emit, fail]
  );

  // Quien recibe: acepta. Aquí NO se negocia todavía, porque la oferta aún no
  // existe: la manda el llamante al enterarse de que hemos aceptado. Aceptar es
  // solo avisar y pedir el permiso de cámara y micrófono.
  const acceptCall = useCallback(async () => {
    const target = peerIdRef.current;
    if (!target) return;

    setError('');
    clearRingTimeout();
    setStatus('connecting');

    try {
      localStreamRef.current = await acquireMedia(kindRef.current);

      // Si el socket se cayó entre el timbrado y la aceptación, el aviso no
      // llegaría al llamante y la llamada quedaría a medias.
      if (!connectedRef.current) {
        fail('Sin conexión: no se pudo aceptar la llamada');
        return;
      }

      emit('call:accept', { to: target });

      // Si la oferta llegó antes de aceptar (red rápida), se contesta ya sin
      // esperar el siguiente mensaje.
      if (pendingOfferRef.current) {
        const offer = pendingOfferRef.current;
        pendingOfferRef.current = null;
        await answerOffer(target, offer);
      }
    } catch (err) {
      emit('call:reject', { to: target, reason: 'sin_permisos' });
      fail(`No se pudo aceptar la llamada: ${err.message}`);
    }
  }, [acquireMedia, answerOffer, clearRingTimeout, emit, fail]);

  // El receptor rechaza. No registra nada: la entrada del hilo la escribe quien
  // llamó, al recibir el aviso, para que exista una sola.
  const rejectCall = useCallback(() => {
    if (peerIdRef.current) {
      emit('call:reject', { to: peerIdRef.current, reason: 'rechazada' });
    }
    cleanup();
  }, [cleanup, emit]);

  const hangUp = useCallback(() => {
    if (peerIdRef.current) emit('call:end', { to: peerIdRef.current });
    // Colgar durante el timbrado es cancelar; una vez contestada, es una llamada
    // atendida con su duración.
    finalize(activeSinceRef.current ? 'answered' : 'cancelled');
  }, [finalize]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOff(!track.enabled);
  }, []);

  // Minimizar solo tiene sentido con la llamada ya en curso: durante el
  // timbrado o una llamada entrante, el usuario tiene que ver qué está pasando
  // y poder aceptar o rechazar.
  const toggleMinimize = useCallback(() => {
    setMinimized((prev) => !prev);
  }, []);

  // Señalización entrante, registrada mientras haya sesión para que una llamada
  // suene desde cualquier pantalla.
  useEffect(() => {
    if (!user) return undefined;

    const unsubs = [
      subscribe('call:incoming', ({ from, kind: incomingKind }) => {
        if (statusRef.current !== IDLE) {
          emit('call:reject', { to: from.id, reason: 'ocupado' });
          return;
        }
        peerIdRef.current = from.id;
        setPeer(from);
        setKind(incomingKind);
        kindRef.current = incomingKind;
        // Quien recibe nunca escribe la entrada del hilo: lo hace quien llamó.
        isCallerRef.current = false;
        setError('');
        setStatus('incoming');
      }),

      // La oferta llega después de aceptar (el llamante la manda al recibir el
      // aviso). Si ya aceptamos, se contesta en el momento; si todavía no —la
      // llamada sigue sonando—, se guarda para contestarla al aceptar. Sin esta
      // distinción el receptor se quedaría esperando una oferta que ya llegó.
      subscribe('call:offer', ({ from, sdp }) => {
        if (String(from) !== String(peerIdRef.current)) return;

        const st = statusRef.current;
        if (st === 'connecting' || st === 'active') {
          answerOffer(peerIdRef.current, sdp);
          return;
        }
        pendingOfferRef.current = sdp;
      }),

      subscribe('call:ringing', ({ reachable, pushed }) => {
        // `pushed` significa que el otro no tiene la app abierta pero sí un
        // dispositivo suscrito: la llamada está sonando en su teléfono. No se
        // corta, se sigue timbrando hasta que conteste o venza el temporizador.
        if (reachable || pushed) return;
        setError('Esa persona no está disponible ahora mismo');
        finalize('unreachable');
      }),

      subscribe('call:accepted', async () => {
        // El otro aceptó: ahora sí se envía la oferta con los medios locales.
        const target = peerIdRef.current;
        if (!target) return;

        try {
          setStatus('connecting');
          const pc = createPeerConnection(target);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          emit('call:offer', { to: target, sdp: pc.localDescription });
        } catch (err) {
          fail(`No se pudo establecer la llamada: ${err.message}`);
        }
      }),

      subscribe('call:rejected', ({ reason }) => {
        const busy = reason === 'ocupado';
        setError(busy ? 'Está en otra llamada' : 'Llamada rechazada');
        // Solo el llamante registra; el receptor no escribe nada al rechazar.
        finalize(busy ? 'missed' : 'declined');
      }),

      subscribe('call:ended', () => {
        if (statusRef.current === IDLE) return;
        setError('La llamada ha terminado');
        // El que cuelga por su cuenta ya lo registró en `hangUp`; aquí se cubre
        // el caso de que cuelgue el otro. El receptor no escribe nada.
        finalize(activeSinceRef.current ? 'answered' : 'cancelled');
      }),

      subscribe('call:answer', async ({ sdp }) => {
        try {
          if (!pcRef.current) return;
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));

          for (const candidate of pendingCandidates.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidates.current = [];
          // El llamante queda activo aquí: es el momento en que empieza a contar
          // la duración que se guarda en el hilo.
          activeSinceRef.current = Date.now();
          setStatus('active');
        } catch (err) {
          fail(`No se pudo establecer la llamada: ${err.message}`);
        }
      }),

      subscribe('call:ice', async ({ candidate }) => {
        if (!candidate) return;
        // Si aún no hay descripción remota, se guarda para aplicarlo después.
        if (!pcRef.current?.remoteDescription) {
          pendingCandidates.current.push(candidate);
          return;
        }
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Un candidato suelto que falla no invalida la llamada.
        }
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [user, subscribe, emit, finalize, fail, createPeerConnection, answerOffer]);

  const value = useMemo(
    () => ({
      status,
      kind,
      peer,
      error,
      notice,
      muted,
      camOff,
      minimized,
      remoteTick,
      // Si la lista ICE trae TURN. La UI lo usa para avisar de que las llamadas
      // pueden cortarse fuera de la red local, en vez de dejar al usuario
      // adivinando por qué se le cae la llamada al salir de casa.
      hasTurn,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleCamera,
      toggleMinimize,
      remoteStreamRef,
      localStreamRef,
    }),
    [
      status,
      kind,
      peer,
      error,
      notice,
      muted,
      camOff,
      minimized,
      remoteTick,
      hasTurn,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleCamera,
      toggleMinimize,
    ]
  );

  // Señal para las pruebas de extremo a extremo: permiten iniciar y aceptar una
  // llamada sin recorrer la interfaz. Solo en desarrollo, como el aviso del
  // socket; en producción no se expone nada al `window`.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__taktakCall = {
      status,
      kind,
      peer,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleCamera,
    };
    return () => {
      delete window.__taktakCall;
    };
  }, [status, kind, peer, startCall, acceptCall, rejectCall, hangUp, toggleMute, toggleCamera]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall debe usarse dentro de CallProvider');
  return ctx;
}
