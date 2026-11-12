const jwt = require('jsonwebtoken');
const env = require('../config/env');
const messages = require('./messageService');
const pushService = require('./pushService');
const sfu = require('./sfuService');
const poker = require('./pokerService');
const asistak = require('./asistakService');
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

// Sala de sockets de una mesa de POKERTAK. Va aparte de la de voz para que el
// estado de la mesa (que incluye las cartas de cada jugador) no llegue a los
// espectadores del directo que no están jugando.
function pokerRoom(roomName) {
  return `poker:${roomName}`;
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

// Cuántos espectadores hay ahora mismo en la sala: los que entraron a ver y
// comentar, sin publicar cámara ni micrófono. Se cuenta por persona (el mapa ya
// es por usuario), así que dos pestañas del mismo espectador no inflan el
// número. El anfitrión y los invitados no cuentan aquí: ellos se ven en la
// rejilla.
function spectatorCount(room) {
  return voiceMembers(room).filter((p) => p.spectate).length;
}

// Cuántos invitados publican ahora mismo (sin contar al anfitrión ni a los
// espectadores). Es lo que se compara con el aforo del directo.
function guestCount(room, hostId) {
  const host = String(hostId ?? '');
  return voiceMembers(room).filter((p) => !p.spectate && String(p.id) !== host).length;
}

// Avisa a toda la sala de cuántos espectadores hay. Se manda el número, no la
// lista: al invitado no le sirve saber quién mira, solo cuántos son (es lo que
// enseña TikTok junto al ojo).
function broadcastViewers(io, room) {
  io.to(voiceRoom(room)).emit('voice:viewers', { count: spectatorCount(room) });
}

// Asistak vigila un comentario del directo. Si falta al respeto, deja su aviso
// en el propio hilo (para que todo el mundo lo vea) y, si el usuario reincide,
// lo suspende. La suspensión se anuncia también en la sala para que quede claro
// por qué esa persona ya no está.
//
// Se lanza sin `await` desde el handler: el chat no puede esperar a la IA. Si el
// usuario estaba en la sala de voz, se le saca al momento para que la suspensión
// tenga efecto ya, no cuando cierre la app.
function moderateLiveComment(io, room, user, text) {
  if (!env.asistak.enabled) return;
  asistak
    .moderateComment({ userId: user.id, text })
    .then((verdict) => {
      if (!verdict || verdict.action === 'none') return;
      io.to(room).emit('live:message', {
        system: true,
        asistak: true,
        text: asistak.warningText(verdict.username, verdict.severity),
        at: Date.now(),
      });
      if (verdict.action === 'suspend') {
        io.to(room).emit('live:message', {
          system: true,
          asistak: true,
          text: asistak.suspensionText(verdict.username, env.asistak.suspensionDays),
          at: Date.now(),
        });
        // Sacar de la sala de voz a quien acaba de ser suspendido: si no, la
        // suspensión solo se notaría al intentar volver a entrar.
        evictSuspendedFromVoice(io, user.id);
      }
    })
    .catch(() => {});
}

// Saca de su sala de voz a un usuario suspendido, en todos sus sockets.
function evictSuspendedFromVoice(io, userId) {
  const id = String(userId);
  for (const socket of io.sockets.sockets.values()) {
    if (String(socket.data?.user?.id) !== id) continue;
    if (!socket.data?.voiceRoom) continue;
    socket.emit('voice:error', {
      error: 'Asistak te ha suspendido del directo por faltar al respeto.',
    });
    leaveVoiceRoom(io, socket);
  }
}

// ¿Puede este usuario entrar al chat en vivo de esta sala? Las salas atadas a un
// TAK Creator heredan su visibilidad: una privada solo se abre a sus miembros.
// El nombre de la sala es público (sale en la lista de creators), así que sin
// esta comprobación cualquiera podría leer y escribir en el directo de otro.
// Las salas sueltas (sin creator detrás) se dejan abiertas, como estaban antes
// de que el directo tuviera comentarios.
async function canAccessLiveRoom(userId, roomName) {
  const squad = await Squad.findOne({ voiceRoom: roomName }).select('visibility members.user');
  if (!squad) return true;
  if (squad.visibility !== 'private') return true;
  return Boolean(userId) && squad.isMember(userId);
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
      const leaving = members.get(userId);
      members.delete(userId);
      if (notify) {
        io.to(voiceRoom(room)).emit('voice:peer-left', { userId });
        // Si quien se va era espectador, el recuento baja: se avisa a los que
        // quedan para que el número junto al ojo no se quede congelado.
        if (leaving?.spectate) broadcastViewers(io, room);
      }
    }
    if (members.size === 0) {
      voiceRooms.delete(room);
      // Sin nadie dentro, el modo se olvida: la próxima vez que alguien entre se
      // vuelve a decidir (y así una sala puede pasar de malla a SFU cuando el
      // SFU esté disponible).
      voiceRoomModes.delete(room);
      // Cerrar el directo cierra también su mesa de POKERTAK: liquida la
      // comisión y devuelve las fichas. Si no, la mesa quedaría abierta en
      // memoria con las monedas de los jugadores dentro.
      const hostId = voiceRoomHosts.get(room);
      if (hostId) poker.closeTable(hostId).catch(() => {});
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

// ------------------------------------------------------------------
// Llamadas grupales ad-hoc (hasta `MAX_GROUP_CALL` personas)
// ------------------------------------------------------------------
//
// Una llamada grupal es una sala de voz efímera que NO cuelga de un TAK Creator,
// así que no puede reutilizar `voice:*`: la membresía de esas salas se comprueba
// contra la base de datos y aquí no hay ninguna a la que pertenecer. En su
// lugar, cada invitado recibe una invitación y solo al aceptarla entra; el
// servidor mantiene quién está dentro y reenvía la señalización (oferta,
// respuesta, ICE) entre pares, igual que la malla del directo. El audio y el
// vídeo nunca pasan por aquí.
//
// El tope es de producto: en malla cada persona sube su audio y su vídeo a CADA
// uno de los demás, así que el coste de subida crece con la sala. Cuatro es lo
// que sostiene bien una conexión móvil normal; para más habría que encender el
// SFU (mediasoup), que hoy está apagado.
const MAX_GROUP_CALL = 4;

// callId -> { id, hostId, kind, origin, members: Map(userId -> member) }
const groupCalls = new Map();
// userId -> Set<socketId> de los sockets de ese usuario dentro de una llamada
// grupal. Se lleva aparte del mapa de la llamada para poder contar por persona
// (dos pestañas no deben ocupar dos plazas) y para expulsar los sockets muertos.
const groupCallSockets = new Map();

function groupRoom(callId) {
  return `groupcall:${callId}`;
}

function groupMembers(callId) {
  const call = groupCalls.get(callId);
  return call ? [...call.members.values()] : [];
}

function announceGroupMembers(io, callId) {
  io.to(groupRoom(callId)).emit('call:group-members', {
    callId,
    members: groupMembers(callId),
  });
}

// Saca al socket de su llamada grupal y avisa a los que quedan. Devuelve el
// `callId` si realmente estaba dentro. Se llama al salir a propósito y al
// desconectar, para que nadie quede como participante fantasma.
function leaveGroupCall(io, socket, notify = true) {
  const callId = socket.data.groupCall;
  if (!callId) return null;
  socket.data.groupCall = null;
  socket.leave(groupRoom(callId));

  const call = groupCalls.get(callId);
  const userId = String(socket.data.user?.id || '');
  if (call) {
    const sockets = groupCallSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      // Solo se quita del mapa si este socket era el último del usuario: con dos
      // pestañas abiertas, cerrar una no debe sacarle de la llamada.
      if (sockets.size === 0) {
        groupCallSockets.delete(userId);
        call.members.delete(userId);
        if (notify) {
          socket.to(groupRoom(callId)).emit('call:group-left', { callId, userId });
          announceGroupMembers(io, callId);
        }
      }
    }
    // La llamada se cierra cuando se queda sin nadie. El anfitrión que se va
    // tampoco la mantiene viva: no hay directo detrás que conservar.
    if (call.members.size === 0) {
      groupCalls.delete(callId);
      // La llamada se quedó vacía. Hay que avisar a quien todavía estuviera
      // timbrando: los invitados que no llegaron a aceptar nunca entraron a la
      // sala, así que no se enterarían por `call:group-left` y su pantalla
      // seguiría sonando para una llamada que ya no existe.
      for (const invitee of call.invitees || []) {
        io.to(userRoom(invitee)).emit('call:group-ended', { callId });
      }
    }
  }
  if (notify) socket.emit('call:group-ended', { callId });
  return callId;
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

    // Si el destinatario no tiene ningún socket abierto (app cerrada o en
    // segundo plano), el `chat:notify` no llega a nadie: sin este push el
    // mensaje se quedaba mudo hasta que abriera la app. Es la mitad que hace
    // que TAK TAK avise como WhatsApp. Con la app abierta no se manda: el aviso
    // en vivo ya lo muestra y un push duplicaría la vibración.
    if (!isOnline(participant)) {
      pushService.sendToUser(participant, messagePushPayload(message)).catch(() => {});
    }

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

// Payload del push de un mensaje. Se manda lo justo para una pantalla de
// bloqueo: quién escribe y un recorte del texto. La etiqueta es estable por
// conversación, así que varios mensajes seguidos del mismo hilo se agrupan en
// una sola notificación en vez de apilar una por mensaje.
function messagePushPayload(message) {
  const sender = message.sender?.username ? `@${message.sender.username}` : 'Nuevo mensaje';
  const body = message.text
    ? String(message.text).slice(0, 120)
    : message.kind === 'attachment'
      ? 'Te envió un archivo'
      : 'Tienes un mensaje nuevo';
  return {
    type: 'message',
    title: sender,
    body,
    tag: `chat-${message.conversation}`,
    data: {
      url: `/?chat=${message.conversation}`,
      type: 'message',
      conversationId: String(message.conversation),
    },
  };
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
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.data.user = null;
      return next();
    }
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      // El nombre se lee de la base, no del token: el token es viejo y arrastra
      // el usuario que había al iniciar sesión. Tras un cambio de nombre, el
      // chat del directo mostraba el antiguo mientras el perfil ya mostraba el
      // nuevo. El id del token manda; el nombre se refresca aquí.
      const user = await User.findById(payload.userId).select('username');
      socket.data.user = {
        id: payload.userId,
        username: user?.username || payload.username,
      };
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

    socket.on('live:join', async ({ room } = {}) => {
      if (typeof room !== 'string' || !room.trim()) return;
      const safeRoom = room.trim().slice(0, 60);
      let allowed = true;
      try {
        allowed = await canAccessLiveRoom(socket.data.user?.id, safeRoom);
      } catch {
        // Ante la duda, cerrado: mejor un aviso que dejar el directo abierto.
        allowed = false;
      }
      if (!allowed) {
        return socket.emit('live:error', { error: 'No tienes acceso a este directo' });
      }
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

      // Solo se publica en una sala a la que el socket se unió de verdad (y
      // `live:join` ya comprobó el acceso): con el nombre de la sala no basta.
      const safeRoom = room.trim().slice(0, 60);
      if (!socket.rooms.has(safeRoom)) return;

      const now = Date.now();
      if (now - lastMessageAt < MIN_MESSAGE_INTERVAL_MS) return;

      const body = text.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!body) return;

      lastMessageAt = now;
      io.to(safeRoom).emit('live:message', {
        user: user.username,
        text: body,
        at: now,
      });

      // Asistak vigila el comentario. Va después de publicarlo para que el
      // aviso aparezca como una línea más del hilo y el mensaje no se pierda
      // mientras el modelo decide. No se espera aquí: el chat no debe frenarse
      // por la moderación.
      moderateLiveComment(io, safeRoom, user, body);
    });

    // Gift animation broadcast. The coin transfer itself goes through the HTTP
    // wallet endpoint; the socket only mirrors the visual for other viewers.
    socket.on('live:gift', ({ room, giftName, iconUrl } = {}) => {
      const user = socket.data.user;
      if (!user || typeof room !== 'string' || typeof giftName !== 'string') return;
      // Igual que los comentarios: solo se anuncia un regalo en la sala propia.
      const safeRoom = room.trim().slice(0, 60);
      if (!socket.rooms.has(safeRoom)) return;
      io.to(safeRoom).emit('live:gift', {
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
    // Llamada grupal ad-hoc (malla WebRTC, hasta `MAX_GROUP_CALL`)
    // ------------------------------------------------------------------
    //
    // Cuatro eventos, con la misma idea que los de la llamada 1 a 1: el servidor
    // reparte invitaciones, lleva la lista de quién está y reenvía la
    // señalización entre pares. No decide medios ni los toca.

    // Quien llama: crea la llamada y avisa a los invitados. El que llama no
    // entra a la sala hasta que el primero acepta (ver `call:group-join`), así
    // que la llamada no se queda abierta si nadie contesta.
    socket.on('call:group-invite', async ({ to, kind, origin } = {}) => {
      if (!me || !Array.isArray(to)) return;
      const callKind = kind === 'video' ? 'video' : 'audio';

      // Invitados válidos: sin repetidos, sin uno mismo y sin cadenas vacías.
      const hostId = String(me.id);
      const invitees = [
        ...new Set(to.map((id) => String(id)).filter((id) => id && id !== hostId)),
      ].slice(0, MAX_GROUP_CALL - 1);
      if (invitees.length === 0) return;

      // Una sola llamada grupal por socket: si ya estaba en otra, sale antes de
      // crear esta, para no quedar en dos sitios con el micrófono abierto.
      if (socket.data.groupCall) leaveGroupCall(io, socket);

      const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      groupCalls.set(callId, {
        id: callId,
        hostId,
        kind: callKind,
        origin: origin === 'whataka' ? 'whataka' : 'app',
        invitees,
        members: new Map([[hostId, { id: hostId, username: me.username, host: true }]]),
      });
      groupCallSockets.set(hostId, new Set([socket.id]));
      socket.data.groupCall = callId;
      // El anfitrión entra ya a la sala: es quien va a ofrecer a cada invitado
      // que acepte, así que tiene que estar dentro para recibir sus respuestas.
      // Si al final no acepta nadie, la llamada se cierra sola al vaciarse.
      socket.join(groupRoom(callId));

      // El idioma de quien llama viaja con la invitación, para que el receptor
      // pueda ofrecer traducir sin tener que preguntarlo.
      const caller = await User.findById(hostId)
        .select('preferredLanguage')
        .lean()
        .catch(() => null);

      const payload = {
        callId,
        from: {
          id: hostId,
          username: me.username,
          language: caller?.preferredLanguage || null,
        },
        kind: callKind,
        origin: origin === 'whataka' ? 'whataka' : 'app',
        at: Date.now(),
      };

      // Solo se invita a quien puede sonar: un socket oculto no repica. Si nadie
      // tiene socket, la llamada no tiene a quién llegar y el cliente la cierra
      // en vez de quedarse timbrando al vacío. (El push de una llamada grupal
      // queda fuera de esta primera versión: encenderlo es añadir el timbre por
      // push, igual que en la 1 a 1, sobre cada invitado.)
      const reachable = (
        await Promise.all(
          invitees.map(async (invitee) => {
            try {
              const sockets = await io.in(userRoom(invitee)).fetchSockets();
              if (!sockets.some((s) => s.data?.visible !== false)) return false;
              io.to(userRoom(invitee)).emit('call:group-incoming', payload);
              return true;
            } catch {
              return false;
            }
          })
        )
      ).filter(Boolean).length;

      socket.emit('call:group-ringing', { callId, invitees, reachable, at: Date.now() });
    });

    // El invitado acepta. Aquí es cuando de verdad entra a la sala: hasta este
    // momento la llamada solo existía como invitación.
    socket.on('call:group-accept', ({ callId } = {}) => {
      if (!me || typeof callId !== 'string') return;
      const call = groupCalls.get(callId);
      if (!call) return socket.emit('call:group-error', { error: 'La llamada ya no existe' });

      const userId = String(me.id);
      // Solo entra quien fue invitado (o el anfitrión). Sin esto, cualquiera que
      // averiguara el `callId` podría meterse en la llamada: el identificador
      // viaja por salas privadas, pero la puerta se cierra aquí igualmente.
      if (userId !== call.hostId && !call.invitees.includes(userId)) {
        return socket.emit('call:group-error', { error: 'No estás invitado a esta llamada' });
      }
      // El aforo cuenta personas, no sockets: quien ya está dentro puede
      // reconectar sin gastar una plaza nueva.
      if (!call.members.has(userId) && call.members.size >= MAX_GROUP_CALL) {
        return socket.emit('call:group-error', { error: 'La llamada está llena' });
      }

      // Los que ya estaban: se le entregan al que entra para que sea él quien
      // llame (oferta) a cada uno. Un único sentido de negociación evita cruzar
      // dos ofertas a la vez.
      const existing = groupMembers(callId).filter((m) => String(m.id) !== userId);

      socket.data.groupCall = callId;
      socket.join(groupRoom(callId));
      if (!groupCallSockets.has(userId)) groupCallSockets.set(userId, new Set());
      groupCallSockets.get(userId).add(socket.id);
      if (!call.members.has(userId)) {
        call.members.set(userId, { id: userId, username: me.username, host: userId === call.hostId });
      }

      socket.emit('call:group-joined', {
        callId,
        kind: call.kind,
        origin: call.origin,
        hostId: call.hostId,
        peers: existing,
        members: groupMembers(callId),
      });

      // A los que ya estaban se les avisa del nuevo; ellos no llaman, esperan la
      // oferta del que entra.
      socket.to(groupRoom(callId)).emit('call:group-peer-joined', {
        callId,
        id: userId,
        username: me.username,
      });
      announceGroupMembers(io, callId);
    });

    // Rechazar una invitación. No hay nada que limpiar en el servidor: el que
    // rechaza nunca entró a la sala.
    socket.on('call:group-reject', ({ callId } = {}) => {
      if (!me || typeof callId !== 'string') return;
      const call = groupCalls.get(callId);
      if (!call) return;
      io.to(userRoom(call.hostId)).emit('call:group-rejected', {
        callId,
        from: String(me.id),
      });
    });

    // Salir (colgar) de una llamada grupal. Cualquiera puede irse; la llamada
    // sigue mientras quede alguien y se cierra sola cuando se vacía.
    socket.on('call:group-leave', ({ callId } = {}) => {
      if (!me) return;
      if (typeof callId === 'string' && socket.data.groupCall !== callId) return;
      leaveGroupCall(io, socket);
    });

    // Señalización de la malla. Igual que en la llamada 1 a 1, es opaca para el
    // servidor: se reenvía tal cual al par indicado, y solo si los dos están en
    // la MISMA llamada (si no, cualquiera podría inyectar SDP a un desconocido).
    for (const event of ['call:group-offer', 'call:group-answer', 'call:group-ice']) {
      socket.on(event, ({ callId, to, ...rest } = {}) => {
        if (!me || typeof to !== 'string' || typeof callId !== 'string') return;
        if (socket.data.groupCall !== callId) return;
        const call = groupCalls.get(callId);
        if (!call || !call.members.has(String(to))) return;
        io.to(userRoom(to)).emit(event, { callId, from: String(me.id), ...rest });
      });
    }

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
    socket.on('voice:join', async ({ slug, mesh, spectate } = {}) => {
      if (!me || typeof slug !== 'string' || !slug.trim()) return;
      // Asistak: una cuenta suspendida no entra a ningún directo, ni siquiera
      // como espectador. Se comprueba en el servidor porque la UI se puede
      // saltar.
      const access = await asistak.checkAccess(me.id);
      if (!access.allowed) {
        return socket.emit('voice:error', { error: access.reason || 'No puedes entrar al directo' });
      }
      // Espectador: entra a ver y comentar, sin publicar cámara ni micrófono. No
      // ocupa plaza de la rejilla, así que no cuenta para el aforo de invitados.
      const asSpectator = spectate === true;
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
        // no de infraestructura. Los espectadores no ocupan plaza: solo miran.
        if (!isHost && !asSpectator && env.liveGuestLimit > 0) {
          const guests = guestCount(room, hostId);
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
        // no se cruzan dos ofertas simultáneas. Los espectadores no publican
        // nada, así que no entran en la lista: llamarles no tendría respuesta.
        const existing = voiceMembers(room).filter((p) => !p.spectate);

        if (!voiceRooms.has(room)) voiceRooms.set(room, new Map());
        voiceRooms.get(room).set(String(me.id), {
          id: String(me.id),
          username: me.username,
          spectate: asSpectator,
        });

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
          viewerCount: spectatorCount(room),
          routerRtpCapabilities,
          producers,
          peers: existing,
        });

        // A los que ya estaban se les avisa del nuevo; ellos no llaman, esperan
        // la oferta del que entra (en malla) o su productor (en SFU). Un
        // espectador no publica, así que no se anuncia como par (nadie debe
        // llamarle ni reservarle una ventana en la rejilla), pero sí se avisa
        // del nuevo recuento de espectadores: es lo que se ve junto al ojo.
        if (asSpectator) {
          broadcastViewers(io, room);
        } else {
          socket.to(voiceRoom(room)).emit('voice:peer-joined', {
            id: String(me.id),
            username: me.username,
          });
          // Si el que entra es un invitado, los espectadores ya le verán; el
          // recuento de espectadores no cambia, pero se manda por si acaso para
          // que todos los clientes queden con el mismo número.
          broadcastViewers(io, room);
        }
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

    // ------------------------------------------------------------------
    // POKERTAK: sala de póker privada del anfitrión del directo
    // ------------------------------------------------------------------
    //
    // La mesa vive en el servidor (`pokerService`): las fichas se compran con
    // monedas al sentarse y se devuelven al levantarse. El cliente nunca manda
    // cartas ni apuestas «a pelo»: solo la acción y, cuando toca, el importe; el
    // servidor decide si es legal. El estado que se emite a cada socket se
    // construye por usuario (`publicState`), de modo que nadie ve las cartas de
    // otro hasta el showdown.

    // Resuelve la mesa del anfitrión a partir del slug del creator, con las
    // mismas comprobaciones de acceso que la sala de voz: la mesa de póker no
    // puede ser una puerta trasera a un creator privado.
    async function pokerTableFor(slug) {
      const squad = await Squad.findOne({ slug: String(slug).trim().toLowerCase() });
      if (!squad || !squad.voiceRoom) return null;
      if (squad.visibility === 'private' && !squad.isMember(me.id)) return null;
      return { hostId: String(squad.owner), room: squad.voiceRoom };
    }

    // Emite a cada socket de la mesa su propia vista (cada uno ve sus cartas y
    // no las de los demás). Los sockets de POKERTAK tienen su propia sala
    // (`poker:room`), separada de la de voz: así los espectadores del directo no
    // reciben estados de una mesa en la que no están.
    async function broadcastTable(room, hostId) {
      const table = poker.getTable(hostId);
      if (!table) return;
      const sockets = await io.in(pokerRoom(room)).fetchSockets();
      for (const s of sockets) {
        s.emit('poker:state', table.publicState(s.data.user?.id || null));
      }
      // La mesa se reparte sola entre manos: si ya hay dos jugadores con fichas y
      // no hay mano en curso, se baraja en un par de segundos. Así nadie se queda
      // en "esperando tu turno" porque el anfitrión no pulse el botón, y quien se
      // sienta a mitad de una mano entra en la siguiente sin esperar a nadie.
      poker.scheduleAutoDeal(hostId, () => {
        broadcastTable(room, hostId).catch(() => {});
      });
    }

    // Abrir la mesa (o entrar en la ya abierta) y recibir el estado actual.
    socket.on('poker:open', async ({ slug } = {}) => {
      if (!me || typeof slug !== 'string') return;
      // Asistak: la suspensión también cierra la sala de juegos.
      const access = await asistak.checkAccess(me.id);
      if (!access.allowed) {
        return socket.emit('poker:error', { error: access.reason || 'No puedes entrar a la mesa' });
      }
      try {
        const info = await pokerTableFor(slug);
        if (!info) return socket.emit('poker:error', { error: 'Mesa no encontrada' });
        const table = poker.getOrCreateTable(info.hostId);
        socket.data.pokerRoom = info.room;
        socket.data.pokerHost = info.hostId;
        socket.join(pokerRoom(info.room));
        socket.emit('poker:state', table.publicState(me.id));
      } catch {
        socket.emit('poker:error', { error: 'No se pudo abrir la mesa' });
      }
    });

    // Sentarse. La entrada se cobra del monedero aquí, en el servidor.
    socket.on('poker:sit', async ({ slug, buyIn } = {}) => {
      if (!me) return;
      try {
        // Asistak: la suspensión impide sentarse, aunque la mesa ya estuviera
        // abierta de antes.
        const access = await asistak.checkAccess(me.id);
        if (!access.allowed) {
          return socket.emit('poker:error', { error: access.reason || 'No puedes sentarte' });
        }
        const info = await pokerTableFor(slug);
        if (!info) return socket.emit('poker:error', { error: 'Mesa no encontrada' });
        await poker.sitDown(info.hostId, me.id, me.username, buyIn);
        socket.data.pokerRoom = info.room;
        socket.data.pokerHost = info.hostId;
        socket.join(pokerRoom(info.room));
        await broadcastTable(info.room, info.hostId);
      } catch (err) {
        socket.emit('poker:error', { error: err.message || 'No se pudo sentar' });
      }
    });

    // Levantarse: devuelve las fichas al monedero.
    socket.on('poker:leave', async () => {
      if (!me || !socket.data.pokerHost) return;
      try {
        await poker.standUp(socket.data.pokerHost, me.id);
        await broadcastTable(socket.data.pokerRoom, socket.data.pokerHost);
        socket.leave(pokerRoom(socket.data.pokerRoom));
      } catch (err) {
        socket.emit('poker:error', { error: err.message || 'No se pudo salir' });
      }
    });

    // Empezar una mano nueva. La comisión es la misma en todas las manos: la fija
    // el servicio al arrancar (`env.poker.rake`, 1%). Solo el anfitrión reparte:
    // si lo pudiera hacer cualquier jugador, cualquiera reiniciaría la mano a
    // mitad para esquivar una apuesta perdida.
    socket.on('poker:start', async () => {
      if (!me || !socket.data.pokerHost) return;
      if (String(socket.data.pokerHost) !== String(me.id)) {
        return socket.emit('poker:error', { error: 'Solo el anfitrión puede repartir' });
      }
      try {
        const table = poker.getTable(socket.data.pokerHost);
        if (!table) return socket.emit('poker:error', { error: 'No hay mesa abierta' });
        poker.startHand(socket.data.pokerHost);
        await broadcastTable(socket.data.pokerRoom, socket.data.pokerHost);
      } catch (err) {
        socket.emit('poker:error', { error: err.message || 'No se pudo empezar la mano' });
      }
    });

    // Actuar: retirarse, pasar, igualar, subir o ir all-in.
    socket.on('poker:act', async ({ action, amount } = {}) => {
      if (!me || !socket.data.pokerHost) return;
      try {
        const table = poker.getTable(socket.data.pokerHost);
        if (!table) return socket.emit('poker:error', { error: 'No hay mesa abierta' });
        const before = table.phase;
        table.act(me.id, action, amount);
        // La comisión solo se cobra cuando la mano termina de verdad, no en cada
        // acción: `showdown` la deja calculada en `table.rake`.
        if (table.phase === 'showdown' && before !== 'showdown') {
          poker.accrueRake(socket.data.pokerHost, table.rake);
        }
        await broadcastTable(socket.data.pokerRoom, socket.data.pokerHost);
      } catch (err) {
        socket.emit('poker:error', { error: err.message || 'Acción no válida' });
      }
    });

    // Cerrar la sala: liquida la comisión al administrador y devuelve las fichas
    // a todos. Es lo que pasa al cerrar el directo o la sala de juegos. Solo
    // puede cerrarla el anfitrión: si lo pudiera hacer cualquier jugador sentado,
    // cualquiera cortaría la partida (y dispararía la liquidación) a los demás.
    socket.on('poker:close', async () => {
      if (!me || !socket.data.pokerHost) return;
      if (String(socket.data.pokerHost) !== String(me.id)) {
        return socket.emit('poker:error', { error: 'Solo el anfitrión puede cerrar la mesa' });
      }
      try {
        await poker.closeTable(socket.data.pokerHost);
        io.to(pokerRoom(socket.data.pokerRoom)).emit('poker:closed', {});
        socket.data.pokerRoom = null;
        socket.data.pokerHost = null;
      } catch (err) {
        socket.emit('poker:error', { error: err.message || 'No se pudo cerrar la mesa' });
      }
    });

    // Al desconectar hay que sacarlo de la sala: si no, los demás seguirían
    // intentando hablar con un socket muerto y el usuario aparecería "dentro"
    // para siempre. En POKERTAK, además, se le devuelven las fichas: si no, sus
    // monedas quedarían dentro de una mesa en memoria a la que ya no puede volver.
    socket.on('disconnect', () => {
      if (me && socket.data.voiceRoom) leaveVoiceRoom(io, socket);
      // Fuera de una llamada grupal al desconectar: si no, los demás seguirían
      // intentando negociar con un socket muerto y el usuario aparecería dentro
      // para siempre.
      if (me && socket.data.groupCall) leaveGroupCall(io, socket, true);
      if (me && socket.data.pokerHost) {
        const hostId = socket.data.pokerHost;
        const room = socket.data.pokerRoom;
        poker
          .standUp(hostId, me.id)
          .then(() => broadcastTable(room, hostId))
          .catch(() => {});
      }
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
