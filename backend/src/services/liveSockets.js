const jwt = require('jsonwebtoken');
const env = require('../config/env');
const messages = require('./messageService');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

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

// Presencia: cuántos sockets abiertos tiene cada usuario ahora mismo. Un mismo
// usuario puede tener varias pestañas, así que se cuenta, no se marca un
// booleano: al cerrar una pestaña no debe decirse que se desconectó si le queda
// otra abierta.
const onlineSockets = new Map();

function isOnline(userId) {
  return (onlineSockets.get(String(userId)) || 0) > 0;
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

    socket.on('call:invite', ({ to, kind, conversationId } = {}) => {
      if (!me || typeof to !== 'string' || to === String(me.id)) return;
      const callKind = kind === 'video' ? 'video' : 'audio';

      const payload = {
        from: { id: me.id, username: me.username },
        kind: callKind,
        conversationId: typeof conversationId === 'string' ? conversationId : null,
        at: Date.now(),
      };

      // `fetchSockets` reports whether anyone is actually listening, so the
      // caller can say "no disponible" instead of ringing into the void.
      io.in(userRoom(to))
        .fetchSockets()
        .then((sockets) => {
          socket.emit('call:ringing', { to, reachable: sockets.length > 0 });
          if (sockets.length > 0) io.to(userRoom(to)).emit('call:incoming', payload);
        })
        .catch(() => socket.emit('call:ringing', { to, reachable: false }));
    });

    // Accept / reject / hang up. `to` is the other party's user id.
    socket.on('call:accept', ({ to } = {}) => {
      if (!me || typeof to !== 'string') return;
      io.to(userRoom(to)).emit('call:accepted', { from: me.id });
    });

    socket.on('call:reject', ({ to, reason } = {}) => {
      if (!me || typeof to !== 'string') return;
      io.to(userRoom(to)).emit('call:rejected', {
        from: me.id,
        reason: typeof reason === 'string' ? reason.slice(0, 60) : 'rechazada',
      });
    });

    socket.on('call:end', ({ to } = {}) => {
      if (!me || typeof to !== 'string') return;
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
};
