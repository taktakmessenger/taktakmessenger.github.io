const jwt = require('jsonwebtoken');
const env = require('../config/env');
const messages = require('./messageService');
const pushService = require('./pushService');
const sfu = require('./sfuService');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Squad = require('../models/Squad');

// Live chat and gift animations. Kept deliberately small: one room per stream,
// membership is verified from the JWT, and messages are capped so a client
// cannot use the socket as an unbounded broadcast channel.
const MAX_MESSAGE_LENGTH = 200;
const HISTORY_LIMIT = 50;

// How long a viewer may post again, in ms. A socket bypasses the HTTP rate
// limiter, so it needs its own.
const MIN_MESSAGE_INTERVAL_MS = 700;

// A user's private room. Prefixed so it can never collide with a stream room
// name supplied by a client through `live:join`.
function userRoom(userId) {
  return `user:${userId}`;
}

// Same idea for the private chat channel between two people.
function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

// A creator's voice room. Derived from the squad's `voiceRoom`, which is set
// server-side at creation, never from a client-supplied string: the room name
// is the only thing standing between a member and a stranger's audio, so it
// must not be forgeable.
function voiceRoom(roomName) {
  return `voice:${roomName}`;
}

// Quién está conectado a cada sala de voz: `voiceRoom -> Map(userId -> user)`.
// Se lleva en memoria porque una sala es efímera: si el proceso cae, no hay
// audio que conservar, solo participantes que vuelven a entrar. Guardar el
// nombre y no el socket permite que un usuario tenga varias pestañas y que las
// salas se vacíen solas al desconectar el último socket.
const voiceRooms = new Map();

// Modo de transporte de cada sala: 'sfu' o 'mesh'. Es una propiedad de la SALA,
// no de cada participante: si dos personas de la misma sala usaran modos
// distintos, la de malla esperaría ofertas que nadie le manda y la de SFU
// esperaría productores que no existen. El primero que entra decide; los demás
// se adaptan. Se borra cuando la sala se vacía.
const voiceRoomModes = new Map();

// Anfitrión de cada sala: `room -> userId`. Es el dueño del TAK Creator. El
// directo de TikTok tiene una ventana más grande para quien lo abre, y para eso
// el cliente necesita saber quién es. Se fija al crear la sala y no cambia
// aunque el anfitrión salga y vuelva: la sala sigue siendo suya. Se borra al
// quedar vacía, como el modo.
const voiceRoomHosts = new Map();

function voiceMembers(room) {
  const members = voiceRooms.get(room);
  return members ? [...members.values()] : [];
}

// Saca al socket de su sala de voz, avisa a los que quedan y devuelve el nombre
// de la sala si realmente estaba dentro. Se llama tanto al salir a propósito
// como al desconectar, para que nadie quede como un participante fantasma.
function leaveVoiceRoom(io, socket, notify = true) {
  const room = socket.data.voiceRoom;
  if (!room) return null;
  socket.data.voiceRoom = null;
  socket.data.voiceMode = null;
  socket.leave(voiceRoom(room));

  // Libera los transportes y productores que este socket tuviera en el SFU. Sin
  // esto, al desconectar quedarían consumiendo puertos hasta que muriera el
  // worker. Se hace aquí y no en el handler de `disconnect` para que valga
  // también al cambiar de sala o al salir a propósito.
  sfu.removeParticipant(room, String(socket.data.user?.id || ''), socket.id).catch(() => {});

  const members = voiceRooms.get(room);
  if (members) {
    const userId = String(socket.data.user.id);
    // Solo se borra del mapa si este socket era el último del usuario. Con dos
    // pestañas abiertas, cerrar una no debe expulsar al usuario de la sala.
    const stillHere = [...(io.sockets.adapter.rooms.get(voiceRoom(room)) || [])].some(
      (socketId) => io.sockets.sockets.get(socketId)?.data?.user?.id?.toString() === userId
    );
    if (!stillHere) {
      members.delete(userId);
      if (notify) {
        io.to(voiceRoom(room)).emit('voice:peer-left', { userId });
      }
    }
    if (members.size === 0) {
      voiceRooms.delete(room);
      // Sin nadie dentro, el modo se olvida: la próxima vez que alguien entre se
      // vuelve a decidir (y así una sala puede pasar de malla a SFU cuando el
      // SFU esté disponible).
      voiceRoomModes.delete(room);
      voiceRoomHosts.delete(room);
    }
  }

  if (notify) socket.emit('voice:left', { room });
  return room;
}

// Presencia: cuántos sockets abiertos tiene cada usuario ahora mismo. Un mismo
// usuario puede tener varias pestañas, así que se cuenta, no se marca un
// booleano: al cerrar una pestaña no debe decirse que se desconectó si le queda
// otra abierta.
const onlineSockets = new Map();

function isOnline(userId) {
  return (onlineSockets.get(String(userId)) || 0) > 0;
}

/**
 * Invitaciones de llamada enviadas por push a alguien que no estaba conectado.
 *
 * Cuando el otro no tiene socket, el `call:invite` no llega a nadie: se manda
 * el push y ya está. Si el usuario abre la app desde la notificación, su socket
 * conecta *después* de que el aviso se emitiera, así que sin esto la llamada se
 * perdería justo cuando el teléfono acaba de sonar — el peor momento posible.
 *
 * Se guardan aquí y se reentregan al conectar. Caducan solas: quien llama cuelga
 * a los 45 s (`ringTimeout` del cliente) y la invitación no debe resucitar una
 * llamada muerta. La entrada se marca con la hora y se ignora si ya venció.
 */
const pendingCalls = new Map();
const PENDING_CALL_TTL_MS = 45000;

function rememberPendingCall(calleeId, payload) {
  pendingCalls.set(String(calleeId), { payload, at: Date.now() });
}

function takePendingCall(calleeId) {
  const entry = pendingCalls.get(String(calleeId));
  if (!entry) return null;
  pendingCalls.delete(String(calleeId));
  if (Date.now() - entry.at > PENDING_CALL_TTL_MS) return null;
  return entry.payload;
}

function clearPendingCall(calleeId) {
  pendingCalls.delete(String(calleeId));
}

/**
 * Timbre continuo por push.
 *
 * Un push suelto no "repica": suena una vez y se acabó. WhatsApp repica hasta
 * que contestas, y eso es justo lo que se pedía. Aquí se reenvía el aviso cada
 * pocos segundos mientras la llamada siga viva; cada reenvío vuelve a sonar y
 * vibrar gracias al `renotify` del payload (sin él, Android reemplazaría la
 * notificación en silencio y el teléfono se quedaría mudo tras el primer
 * pitido).
 *
 * Se para al aceptar, rechazar o colgar, y también al caducar (mismo TTL que la
 * invitación pendiente): un teléfono no debe seguir sonando por una llamada que
 * ya nadie espera.
 */
const RING_INTERVAL_MS = 5000;
// El intervalo se lee al arrancar el timbre, no al cargar el módulo, para que
// una prueba pueda acortarlo sin recargar nada.
function ringInterval() {
  return Number(process.env.CALL_RING_INTERVAL_MS) || RING_INTERVAL_MS;
}
const ringingTimers = new Map();

function startRinging(calleeId, payload) {
  const id = String(calleeId);
  stopRinging(id);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - startedAt > PENDING_CALL_TTL_MS) {
      stopRinging(id);
      return;
    }
    // Un fallo de red en un reenvío no debe cortar el timbre: el siguiente
    // intento vuelve a probar mientras la llamada siga viva.
    pushService
      .sendToUser(id, payload, pushService.CALL_PUSH_OPTIONS)
      .catch(() => {});
  }, ringInterval());
  // No debe mantener vivo el proceso si todo lo demás se apaga.
  timer.unref?.();
  ringingTimers.set(id, timer);
}

function stopRinging(calleeId) {
  const id = String(calleeId);
  const timer = ringingTimers.get(id);
  if (timer) {
    clearInterval(timer);
    ringingTimers.delete(id);
  }
}

function stopAllRinging() {
  for (const timer of ringingTimers.values()) clearInterval(timer);
  ringingTimers.clear();
}

// Avisa del cambio de presencia a las personas que comparten un chat con él.
// Solo a esas: la presencia es un dato de contactos, no un directorio abierto.
async function announcePresence(io, userId, online) {
  try {
    const conversations = await Conversation.find({ participants: userId }).select('_id');
    for (const conversation of conversations) {
      io.to(conversationRoom(String(conversation._id))).emit('chat:presence', {
        userId: String(userId),
        online,
        at: Date.now(),
      });
    }
  } catch {
    // Un fallo avisando de presencia no debe tumbar la conexión del usuario.
  }
}

// The socket server instance, kept module-level so HTTP handlers can reach it.
// Set once at startup; stays null when socket.io is not installed, which is why
// every use below is guarded.
let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function getIo() {
  return ioInstance;
}

// Delivers a stored message to everyone who should see it: the conversation room
// (everyone with the thread open, including the sender's other tabs) and each
// recipient's personal room (for the unread badge when the thread is closed).
//
// Both the REST endpoint and the socket handler call this, so a message looks
// the same to every client no matter which path sent it.
function broadcastMessage(message, participants, senderId) {
  if (!ioInstance) return;

  ioInstance.to(conversationRoom(String(message.conversation))).emit('chat:message', message);

  for (const participant of participants) {
    if (String(participant) === String(senderId)) continue;
    ioInstance.to(userRoom(String(participant))).emit('chat:notify', message);

    // Recibo de entrega: si el destinatario tiene algún socket abierto, el
    // mensaje acaba de llegar a su dispositivo y el emisor puede pasar al
    // segundo tick. Se comprueba por sockets en vez de darlo por hecho porque
    // emitir a una sala vacía no entrega nada.
    ioInstance
      .in(userRoom(String(participant)))
      .fetchSockets()
      .then(async (sockets) => {
        if (!sockets.length) return;
        const { deliveredIds } = await messages.markDelivered(message.conversation, participant);
        if (!deliveredIds.length) return;
        ioInstance
          .to(userRoom(String(senderId)))
          .emit('chat:delivered', { conversationId: String(message.conversation), ids: deliveredIds });
      })
      .catch(() => {});
  }
}

function initLiveSockets(server) {
  // Required lazily so the HTTP API can run without socket.io installed.
  const { Server } = require('socket.io');

  const io = new Server(server, {
    cors: { origin: env.socketCorsOrigin },
  });

  // The HTTP routes need the same instance to fan out a message that arrived
  // over REST. Without this the socket path and the REST path would deliver
  // different things, and a message sent through the API would never reach an
  // open tab in real time.
  setIo(io);

  // The handshake is the only place a socket proves who it is. An anonymous
  // socket is allowed to watch but not to post.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.data.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      socket.data.user = { id: payload.userId, username: payload.username };
      return next();
    } catch {
      return next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    let lastMessageAt = 0;

    const me = socket.data.user;

    // Private channels. A user's own room is where personal events land
    // (new messages, incoming calls) regardless of which page they are on.
    // Joining is automatic and derived from the verified token, never from a
    // client-supplied id, so nobody can subscribe to someone else's events.
    if (me) {
      socket.join(userRoom(me.id));

      // Presencia: al primer socket del usuario se le marca en línea; con el
      // último que se va, se guarda la hora de desconexión para poder mostrar
      // "última vez…" en lugar de dejarlo en línea para siempre.
      const id = String(me.id);
      const before = onlineSockets.get(id) || 0;
      onlineSockets.set(id, before + 1);
      if (before === 0) announcePresence(io, id, true);

      // Si esta conexión viene de abrir la notificación de una llamada, la
      // invitación ya se emitió cuando no había socket. Se reentrega ahora.
      const pendingCall = takePendingCall(id);
      if (pendingCall) socket.emit('call:incoming', pendingCall);
      // El timbre por push NO se para aquí: al conectar todavía no se sabe si
      // la pestaña está a la vista, y un reconecte en segundo plano (un corte de
      // red) pararía el timbre por error. De eso se encarga `app:visibility`,
      // que el cliente manda justo después de conectar.

      // El cliente informa de si su pestaña está en primer plano. Es lo que
      // permite distinguir "tiene la app abierta y puede sonar" de "tiene el
      // socket abierto pero está en segundo plano". Al volver al frente se le
      // reentrega la invitación que se le mandó por push, para que suene en la
      // app sin depender de que pulse la notificación.
      socket.on('app:visibility', ({ visible } = {}) => {
        socket.data.visible = visible !== false;
        if (socket.data.visible) {
          const pending = takePendingCall(id);
          if (pending) socket.emit('call:incoming', pending);
          // Volvió al frente: la llamada ya suena dentro de la app, así que el
          // reenvío por push sobra y solo haría sonar dos veces.
          stopRinging(id);
        }
      });

      socket.on('disconnect', () => {
        const current = (onlineSockets.get(id) || 1) - 1;
        if (current <= 0) {
          onlineSockets.delete(id);
          User.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
          announcePresence(io, id, false);
        } else {
          onlineSockets.set(id, current);
        }
      });
    }

    socket.on('live:join', ({ room } = {}) => {
      if (typeof room !== 'string' || !room.trim()) return;
      const safeRoom = room.trim().slice(0, 60);
      socket.join(safeRoom);
      socket.emit('live:joined', { room: safeRoom, you: socket.data.user });
    });

    socket.on('live:leave', ({ room } = {}) => {
      if (typeof room === 'string') socket.leave(room.trim().slice(0, 60));
    });

    socket.on('live:message', ({ room, text } = {}) => {
      const user = socket.data.user;
      // Posting requires an identity, otherwise the chat is trivially spamable.
      if (!user || typeof room !== 'string' || typeof text !== 'string') return;

      const now = Date.now();
      if (now - lastMessageAt < MIN_MESSAGE_INTERVAL_MS) return;

      const body = text.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!body) return;

      lastMessageAt = now;
      io.to(room.trim().slice(0, 60)).emit('live:message', {
        user: user.username,
        text: body,
        at: now,
      });
    });

    // Gift animation broadcast. The coin transfer itself goes through the HTTP
    // wallet endpoint; the socket only mirrors the visual for other viewers.
    socket.on('live:gift', ({ room, giftName, iconUrl } = {}) => {
      const user = socket.data.user;
      if (!user || typeof room !== 'string' || typeof giftName !== 'string') return;
      io.to(room.trim().slice(0, 60)).emit('live:gift', {
        from: user.username,
        giftName: giftName.slice(0, 40),
        iconUrl: typeof iconUrl === 'string' ? iconUrl.slice(0, 300) : null,
        at: Date.now(),
      });
    });

    // ------------------------------------------------------------------
    // Mensajería privada
    // ------------------------------------------------------------------

    // Joining a conversation room is authorised by the same membership check the
    // REST API uses, so the socket cannot become a way around it.
    socket.on('chat:join', async ({ conversationId } = {}) => {
      if (!me || typeof conversationId !== 'string') return;
      try {
        await messages.loadForParticipant(conversationId, me.id);
        socket.join(conversationRoom(conversationId));
      } catch {
        // Not a participant (or no such conversation). Stay silent rather than
        // revealing which of the two it was.
      }
    });

    socket.on('chat:leave', ({ conversationId } = {}) => {
      if (typeof conversationId === 'string') {
        socket.leave(conversationRoom(conversationId));
      }
    });

    // "Escribiendo…". Es efímero: no se guarda ni se acusa recibo, solo se
    // reenvía al hilo para que el otro vea los puntos suspensivos. Requiere ser
    // participante, para que no se pueda espiar un hilo ajeno por el socket.
    socket.on('chat:typing', async ({ conversationId, typing } = {}) => {
      if (!me || typeof conversationId !== 'string') return;
      try {
        await messages.loadForParticipant(conversationId, me.id);
        socket.to(conversationRoom(conversationId)).emit('chat:typing', {
          conversationId,
          userId: String(me.id),
          typing: typing !== false,
        });
      } catch {
        // Ajeno o inexistente: se ignora.
      }
    });

    // El destinatario confirma que ha leído el hilo (normalmente al abrirlo).
    // Se marca en la base y se avisa al emisor para que sus ticks pasen a azul.
    socket.on('chat:read', async ({ conversationId } = {}) => {
      if (!me || typeof conversationId !== 'string') return;
      try {
        const { readIds } = await messages.markRead(conversationId, me.id);
        if (!readIds.length) return;
        socket.to(conversationRoom(conversationId)).emit('chat:read', {
          conversationId,
          by: String(me.id),
          ids: readIds,
        });
      } catch {
        // Ajeno o inexistente: se ignora.
      }
    });

    // Sending over the socket runs the same service as the REST endpoint, so
    // the stored message, the preview and the unread counters are identical
    // whichever path the client used.
    socket.on('chat:send', async ({ conversationId, text } = {}) => {
      if (!me || typeof conversationId !== 'string') return;

      const now = Date.now();
      if (now - lastMessageAt < MIN_MESSAGE_INTERVAL_MS) return;

      try {
        const { message, participants } = await messages.sendMessage({
          conversationId,
          senderId: me.id,
          text: typeof text === 'string' ? text.slice(0, MAX_MESSAGE_LENGTH * 10) : '',
        });
        lastMessageAt = now;

        // Everyone in the thread, including the sender's other open tabs, plus
        // each recipient's personal room for the unread badge.
        broadcastMessage(message, participants, me.id);
      } catch {
        // Invalid conversation, empty body, etc. The REST endpoint is the one
        // that returns a proper error; the socket just ignores it.
      }
    });

    // ------------------------------------------------------------------
    // Llamadas de voz y vídeo (señalización WebRTC)
    // ------------------------------------------------------------------
    //
    // This server relays call setup only; the audio and video never pass through
    // it. It is deliberately a dumb relay: it does not decide who may call whom
    // beyond requiring an authenticated socket, and it tells the caller the
    // truth about whether the callee is reachable.

    socket.on('call:invite', async ({ to, kind, conversationId, origin } = {}) => {
      if (!me || typeof to !== 'string' || to === String(me.id)) return;
      const callKind = kind === 'video' ? 'video' : 'audio';

      // El idioma de cada parte viaja con la llamada. Sin él, la app no puede
      // saber si hace falta traducir y tendría que preguntarlo al usuario en
      // cada llamada, que es justo lo que hace que nadie use la función.
      // Se lee aquí y no en el cliente porque el cliente no puede fiarse del
      // idioma que le digan: es un dato del perfil, no de la llamada.
      const [caller, callee] = await Promise.all([
        User.findById(me.id).select('preferredLanguage').lean().catch(() => null),
        User.findById(to).select('preferredLanguage').lean().catch(() => null),
      ]);

      const payload = {
        from: {
          id: me.id,
          username: me.username,
          language: caller?.preferredLanguage || null,
        },
        kind: callKind,
        // De dónde salió la llamada. Se reenvía tal cual (validado) porque el
        // receptor decide con ello si ofrece traducir: la traducción en vivo es
        // una función de WhaTaka, no del marcador ni del feed.
        origin: origin === 'whataka' ? 'whataka' : 'app',
        conversationId: typeof conversationId === 'string' ? conversationId : null,
        at: Date.now(),
      };

      // `fetchSockets` reports whether anyone is actually listening, so the
      // caller can say "no disponible" instead of ringing into the void.
      //
      // Pero "no disponible" ya no es el final: si el otro tiene la app
      // instalada pero cerrada, no hay socket y aun así se le puede despertar
      // con una notificación push. Eso es lo que hace que suene como WhatsApp.
      //
      // Se emite `call:ringing` UNA sola vez, al final, ya con la decisión
      // tomada. Emitirlo antes de intentar el push rompería la función: el
      // cliente vería `reachable: false` y colgaría la llamada como "no
      // disponible" justo antes de que llegara el `pushed: true`.
      io.in(userRoom(to))
        .fetchSockets()
        .then(async (sockets) => {
          // Un socket oculto no puede repicar: la pestaña existe, pero el
          // usuario no la está mirando y el tono no suena. Contarlo como
          // "disponible" era justo el fallo: la app cerrada o en segundo plano
          // dejaba el socket abierto, el servidor daba la llamada por entregada
          // y no mandaba push, así que el teléfono no repicaba nunca.
          //
          // `visible !== false` deja pasar a quien aún no ha informado: una
          // pestaña recién abierta, antes de mandar su primer `app:visibility`.
          const canRing = sockets.filter((s) => s.data?.visible !== false);

          if (canRing.length > 0) {
            socket.emit('call:ringing', {
              to,
              reachable: true,
              // Idioma del otro para el llamante, que también necesita saber si
              // le van a entender sin traducir.
              language: callee?.preferredLanguage || null,
            });
            io.to(userRoom(to)).emit('call:incoming', payload);
            return;
          }

          if (!pushService.isConfigured()) {
            socket.emit('call:ringing', {
              to,
              reachable: false,
              language: callee?.preferredLanguage || null,
            });
            return;
          }

          const { sent } = await pushService.sendToUser(
            to,
            pushService.incomingCallPayload({
              from: { id: me.id, username: me.username },
              kind: callKind,
              conversationId: payload.conversationId,
            }),
            // Urgencia alta: es lo que despierta el teléfono al instante con la
            // pantalla apagada. Con urgencia normal Android lo aplaza en reposo
            // y la llamada llega cuando ya caducó.
            pushService.CALL_PUSH_OPTIONS
          );

          if (sent > 0) {
            // El aviso se emitió cuando el otro no estaba: se guarda para
            // entregarlo en el instante en que su socket conecte al abrir la
            // notificación. Sin esto la llamada se perdería al aceptarla.
            rememberPendingCall(to, payload);
            // Y se sigue timbrando: un solo push suena una vez, no "repica".
            // WhatsApp repica hasta que contestas; esto es lo que lo imita.
            startRinging(
              to,
              pushService.incomingCallPayload({
                from: { id: me.id, username: me.username },
                kind: callKind,
                conversationId: payload.conversationId,
              })
            );
          }

          // `pushed: true` le dice al marcador que, aunque no haya socket, la
          // llamada sí está sonando en el dispositivo del otro. Sin esto el
          // llamante vería "no disponible" mientras el teléfono suena.
          socket.emit('call:ringing', {
            to,
            reachable: false,
            pushed: sent > 0,
            language: callee?.preferredLanguage || null,
          });
        })
        .catch(() => socket.emit('call:ringing', { to, reachable: false }));
    });

    // Accept / reject / hang up. `to` is the other party's user id.
    socket.on('call:accept', ({ to } = {}) => {
      if (!me || typeof to !== 'string') return;
      // Ya no hace falta la invitación pendiente: si no se limpiara, un
      // reconecte del mismo usuario le haría sonar una llamada ya en curso.
      clearPendingCall(me.id);
      // Y se deja de timbrar: ya contestó.
      stopRinging(me.id);
      io.to(userRoom(to)).emit('call:accepted', { from: me.id });
    });

    socket.on('call:reject', ({ to, reason } = {}) => {
      if (!me || typeof to !== 'string') return;
      clearPendingCall(me.id);
      stopRinging(me.id);
      io.to(userRoom(to)).emit('call:rejected', {
        from: me.id,
        reason: typeof reason === 'string' ? reason.slice(0, 60) : 'rechazada',
      });
    });

    socket.on('call:end', ({ to } = {}) => {
      if (!me || typeof to !== 'string') return;
      clearPendingCall(me.id);
      // Colgar puede venir del que llama o del que recibe: se para el timbre de
      // los dos, porque el temporizador está a nombre de quien lo sufre (el
      // receptor) y no se sabe aquí cuál de los dos es.
      stopRinging(me.id);
      stopRinging(to);
      io.to(userRoom(to)).emit('call:ended', { from: me.id });
    });

    // WebRTC negotiation payloads (SDP offer/answer and ICE candidates). Opaque
    // to the server, forwarded verbatim to the one intended peer.
    for (const event of ['call:offer', 'call:answer', 'call:ice']) {
      socket.on(event, ({ to, ...rest } = {}) => {
        if (!me || typeof to !== 'string') return;
        io.to(userRoom(to)).emit(event, { from: me.id, ...rest });
      });
    }

    // Texto reconocido de la voz, para la traducción en vivo de una llamada.
    //
    // Va aparte de los eventos de arriba porque NO es opaco: se valida y se
    // recorta. Es texto que viene de un cliente y que el otro lado va a traducir
    // y a decir en voz alta, así que no puede llegar sin límite ni sin ser una
    // cadena. Se limita a 1000 caracteres, que es más que cualquier frase que se
    // diga de una vez, y evita que un cliente malicioso use el servidor como
    // amplificador para mandar un texto enorme al otro.
    socket.on('call:speech', ({ to, text } = {}) => {
      if (!me || typeof to !== 'string') return;
      if (typeof text !== 'string') return;
      const clean = text.trim().slice(0, 1000);
      if (!clean) return;
      io.to(userRoom(to)).emit('call:speech', { from: me.id, text: clean });
    });

    // ------------------------------------------------------------------
    // Sala de voz de un TAK Creator (audio en grupo, malla WebRTC)
    // ------------------------------------------------------------------
    //
    // El audio no pasa por aquí: el servidor solo reparte quién está en la sala
    // y reenvía la señalización (oferta/respuesta/ICE) entre pares. Es una malla
    // completa: cada participante abre una conexión con cada uno de los demás.
    // Sirve para grupos pequeños (el caso de un creator y sus fans), que es
    // justo el tamaño para el que está pensado un squad.

    // Entrar. La membresía se comprueba contra la base de datos, igual que el
    // endpoint REST del feed: el socket no puede ser una puerta trasera a la
    // sala de un creator privado.
    socket.on('voice:join', async ({ slug, mesh } = {}) => {
      if (!me || typeof slug !== 'string' || !slug.trim()) return;
      try {
        const squad = await Squad.findOne({ slug: slug.trim().toLowerCase() });
        if (!squad || !squad.voiceRoom) {
          return socket.emit('voice:error', { error: 'Creator no encontrado' });
        }
        if (squad.visibility === 'private' && !squad.isMember(me.id)) {
          return socket.emit('voice:error', { error: 'Debes ser miembro del creator' });
        }

        // Una sola sala por socket: si estaba en otra, sale primero para no
        // quedar conectado a dos sitios a la vez (y con el micrófono abierto).
        if (socket.data.voiceRoom) leaveVoiceRoom(io, socket);

        const room = squad.voiceRoom;

        // El anfitrión del directo es el dueño del TAK Creator. Se fija la
        // primera vez que se abre la sala y se mantiene aunque él salga y
        // vuelva: la sala es suya mientras exista.
        const hostId = String(squad.owner);
        if (!voiceRoomHosts.has(room)) voiceRoomHosts.set(room, hostId);
        const isHost = String(me.id) === voiceRoomHosts.get(room);

        // Aforo del directo: el anfitrión más hasta `liveGuestLimit` invitados.
        // Se cuenta por persona (no por pestaña) y sin contar al anfitrión, así
        // que el límite no cambia porque alguien abra dos pestañas. Se aplica en
        // cualquier modo: es un límite de producto (la rejilla no da para más),
        // no de infraestructura.
        if (!isHost && env.liveGuestLimit > 0) {
          const guests = voiceMembers(room).filter(
            (p) => String(p.id) !== hostId
          ).length;
          if (guests >= env.liveGuestLimit) {
            return socket.emit('voice:error', {
              error: `El directo está lleno (${env.liveGuestLimit} invitados)`,
            });
          }
        }

        // Aforo del SFU, aparte del de producto: protege los puertos de media.
        // Se comprueba antes de tocar el SFU para no crear un router que luego
        // se quedaría vacío.
        if (env.sfuMaxParticipants > 0 && sfu.isAvailable()) {
          const already = sfu.getRoom(room)?.hasUser(me.id);
          const current = sfu.participantCount(room);
          if (!already && current >= env.sfuMaxParticipants) {
            return socket.emit('voice:error', { error: 'La sala está llena' });
          }
        }

        socket.data.voiceRoom = room;
        socket.join(voiceRoom(room));

        // Quienes ya estaban: se le entregan al que llega para que sea él quien
        // llame (oferta) a cada uno. Así hay un único sentido de negociación y
        // no se cruzan dos ofertas simultáneas.
        const existing = voiceMembers(room);

        if (!voiceRooms.has(room)) voiceRooms.set(room, new Map());
        voiceRooms.get(room).set(String(me.id), { id: String(me.id), username: me.username });

        // SFU o malla. El modo es de la SALA: el primero que entra decide y los
        // demás se adaptan. Si cada uno eligiera por su cuenta, una sala mixta
        // quedaría sorda —quien espera ofertas no las recibe y quien espera
        // productores tampoco—. Se intenta SFU (es lo que permite salas grandes)
        // y se cae a malla si no está disponible.
        let mode = voiceRoomModes.get(room);
        if (!mode) {
          // `mesh` es una petición explícita del cliente (lo usa el e2e para
          // probar las dos vías). Sin ella, se prefiere SFU.
          mode = !mesh && sfu.isAvailable() ? 'sfu' : 'mesh';
          voiceRoomModes.set(room, mode);
        }

        let routerRtpCapabilities = null;
        let producers = [];
        if (mode === 'sfu') {
          const sfuRoom = await sfu.getOrCreateRoom(room);
          if (sfuRoom) {
            sfuRoom.addUser(me.id, socket.id);
            routerRtpCapabilities = sfuRoom.router.rtpCapabilities;
            // Los micrófonos ya vivos, para que el que entra se suscriba a ellos
            // sin esperar a que los demás vuelvan a producir.
            producers = sfu.listProducers(room);
          } else {
            // El SFU dijo que sí pero no pudo levantar la sala (worker caído).
            // Se degrada la sala entera a malla en lugar de dejarla muda.
            mode = 'mesh';
            voiceRoomModes.set(room, mode);
          }
        }
        socket.data.voiceMode = mode;

        socket.emit('voice:joined', {
          room,
          slug: squad.slug,
          name: squad.name,
          mode,
          hostId: voiceRoomHosts.get(room),
          guestLimit: env.liveGuestLimit,
          routerRtpCapabilities,
          producers,
          peers: existing,
        });

        // A los que ya estaban se les avisa del nuevo; ellos no llaman, esperan
        // la oferta del que entra (en malla) o su productor (en SFU).
        socket.to(voiceRoom(room)).emit('voice:peer-joined', {
          id: String(me.id),
          username: me.username,
        });
      } catch {
        socket.emit('voice:error', { error: 'No se pudo entrar en la sala de voz' });
      }
    });

    socket.on('voice:leave', () => {
      if (!me) return;
      leaveVoiceRoom(io, socket);
    });

    // ------------------------------------------------------------------
    // Señalización del SFU
    // ------------------------------------------------------------------
    //
    // Solo tienen sentido si el socket entró en modo SFU. El resto de la
    // comprobación (que sea de la misma sala) ya la hace el propio servicio: los
    // transportes y productores se buscan por la sala del socket, así que un
    // socket no puede tocar los de otra.
    //
    // Usan acuse de recibo (`ack`) en vez de un evento de respuesta: el cliente
    // necesita el resultado para continuar (crear el transporte, publicar…) y
    // con un `await` el código queda lineal en lugar de encadenar eventos.

    socket.on('voice:create-transport', async ({ direction } = {}, ack) => {
      if (!me || socket.data.voiceMode !== 'sfu' || !socket.data.voiceRoom) {
        return ack?.({ ok: false, error: 'No estás en una sala de voz' });
      }
      try {
        const room = sfu.getRoom(socket.data.voiceRoom);
        if (!room) return ack?.({ ok: false, error: 'Sala no disponible' });
        const params = await sfu.createWebRtcTransport(room, socket.id);
        ack?.({ ok: true, direction: direction === 'recv' ? 'recv' : 'send', ...params });
      } catch {
        ack?.({ ok: false, error: 'No se pudo preparar el audio' });
      }
    });

    socket.on('voice:connect-transport', async ({ transportId, dtlsParameters } = {}, ack) => {
      if (!me || socket.data.voiceMode !== 'sfu' || !socket.data.voiceRoom) {
        return ack?.({ ok: false, error: 'No estás en una sala de voz' });
      }
      try {
        const room = sfu.getRoom(socket.data.voiceRoom);
        if (!room) return ack?.({ ok: false, error: 'Sala no disponible' });
        await sfu.connectTransport(room, transportId, dtlsParameters);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'No se pudo conectar el audio' });
      }
    });

    socket.on('voice:produce', async ({ transportId, kind, rtpParameters, appData } = {}, ack) => {
      if (!me || socket.data.voiceMode !== 'sfu' || !socket.data.voiceRoom) {
        return ack?.({ ok: false, error: 'No estás en una sala de voz' });
      }
      try {
        const room = sfu.getRoom(socket.data.voiceRoom);
        if (!room) return ack?.({ ok: false, error: 'Sala no disponible' });
        const { id } = await sfu.produce(room, transportId, me.id, {
          kind: kind === 'video' ? 'video' : 'audio',
          rtpParameters,
          appData,
        });
        ack?.({ ok: true, producerId: id });

        // Avisa a los demás para que se suscriban a este flujo. Se manda el
        // `kind` para que el cliente sepa si es micrófono o cámara antes de
        // tenerlo, y el `userId` para saber de quién es.
        socket.to(voiceRoom(socket.data.voiceRoom)).emit('voice:new-producer', {
          producerId: id,
          userId: String(me.id),
          username: me.username,
          kind: kind === 'video' ? 'video' : 'audio',
        });
      } catch {
        ack?.({ ok: false, error: 'No se pudo publicar tu cámara o micrófono' });
      }
    });

    socket.on('voice:consume', async ({ transportId, producerId, rtpCapabilities } = {}, ack) => {
      if (!me || socket.data.voiceMode !== 'sfu' || !socket.data.voiceRoom) {
        return ack?.({ ok: false, error: 'No estás en una sala de voz' });
      }
      try {
        const room = sfu.getRoom(socket.data.voiceRoom);
        if (!room) return ack?.({ ok: false, error: 'Sala no disponible' });
        const consumer = await sfu.consume(room, transportId, { producerId, rtpCapabilities });
        ack?.({ ok: true, ...consumer });
      } catch {
        // Un productor que ya no existe (el otro salió justo ahora) no es un
        // error que deba romper la sala: se ignora.
        ack?.({ ok: false, error: 'Audio no disponible' });
      }
    });

    socket.on('voice:resume-consumer', async ({ consumerId } = {}, ack) => {
      if (!me || socket.data.voiceMode !== 'sfu' || !socket.data.voiceRoom) {
        return ack?.({ ok: false, error: 'No estás en una sala de voz' });
      }
      try {
        const room = sfu.getRoom(socket.data.voiceRoom);
        if (room) await sfu.resumeConsumer(room, consumerId);
        ack?.({ ok: true });
      } catch {
        // Ignorado: el consumidor pudo cerrarse entre medias.
        ack?.({ ok: false, error: 'Audio no disponible' });
      }
    });

    // Micrófono silenciado. Es solo un aviso para pintar el icono en los demás;
    // quien corta el audio de verdad es la pista local.
    socket.on('voice:mute', ({ muted } = {}) => {
      if (!me || !socket.data.voiceRoom) return;
      socket
        .to(voiceRoom(socket.data.voiceRoom))
        .emit('voice:peer-mute', { userId: String(me.id), muted: muted !== false });
    });

    // Cámara apagada. Igual que el micrófono: es un aviso para que los demás
    // muestren el avatar en vez de un vídeo congelado. Quien apaga la cámara de
    // verdad es el cliente, desactivando la pista.
    socket.on('voice:camera', ({ off } = {}) => {
      if (!me || !socket.data.voiceRoom) return;
      socket
        .to(voiceRoom(socket.data.voiceRoom))
        .emit('voice:peer-camera', { userId: String(me.id), off: off !== false });
    });

    // Señalización entre pares de la sala (solo malla). Igual que en las
    // llamadas 1 a 1, el servidor reenvía el contenido tal cual, pero solo a
    // alguien que esté en la misma sala: sin esa comprobación un socket podría
    // inyectar SDP en la llamada de dos desconocidos. En SFU no se usa: el audio
    // va por el servidor y aquí no hay nada que negociar entre pares.
    for (const event of ['voice:offer', 'voice:answer', 'voice:ice']) {
      socket.on(event, ({ to, ...rest } = {}) => {
        if (!me || typeof to !== 'string' || !socket.data.voiceRoom) return;
        if (socket.data.voiceMode !== 'mesh') return;
        const room = socket.data.voiceRoom;
        const members = voiceRooms.get(room);
        if (!members || !members.has(String(to))) return;
        io.to(userRoom(to)).emit(event, { from: String(me.id), room, ...rest });
      });
    }

    // Al desconectar hay que sacarlo de la sala: si no, los demás seguirían
    // intentando hablar con un socket muerto y el usuario aparecería "dentro"
    // para siempre.
    socket.on('disconnect', () => {
      if (me && socket.data.voiceRoom) leaveVoiceRoom(io, socket);
    });

  });

  return io;
}

module.exports = {
  initLiveSockets,
  getIo,
  setIo,
  broadcastMessage,
  isOnline,
  MAX_MESSAGE_LENGTH,
  HISTORY_LIMIT,
  // Para pruebas: permiten comprobar el timbre continuo sin depender del reloj.
  startRinging,
  stopRinging,
  stopAllRinging,
};
