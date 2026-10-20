const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { HttpError } = require('../utils/http');

const MAX_PAGE = 50;

// Loads a conversation and asserts the caller is in it. Every read and write in
// this service goes through here: membership is the only thing separating a
// private thread from a public one, so it is checked in one place rather than
// re-implemented per endpoint.
async function loadForParticipant(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new HttpError(404, 'Conversación no encontrada');

  if (!conversation.hasParticipant(userId)) {
    // Deliberately 404 rather than 403: answering "forbidden" would confirm the
    // conversation exists, letting someone probe for valid ids.
    throw new HttpError(404, 'Conversación no encontrada');
  }

  return conversation;
}

// Returns the existing direct conversation between two users, creating it on
// first use. The deterministic `key` plus the unique index make this safe under
// concurrent requests: both callers race, one insert wins, the other retries
// into a find.
async function findOrCreateDirect(userId, otherId) {
  if (String(userId) === String(otherId)) {
    throw new HttpError(400, 'No puedes iniciar una conversación contigo mismo');
  }

  const other = await User.findById(otherId).select('username profile');
  if (!other) throw new HttpError(404, 'Usuario no encontrado');

  const key = Conversation.directKey(userId, otherId);

  const existing = await Conversation.findOne({ key });
  if (existing) return existing;

  try {
    return await Conversation.create({
      type: 'direct',
      key,
      participants: [userId, otherId],
      unread: {},
    });
  } catch (err) {
    // Duplicate key means the other request won the race; use its document.
    if (err.code === 11000) return Conversation.findOne({ key });
    throw err;
  }
}

async function listConversations(userId, limit = 30) {
  const conversations = await Conversation.find({ participants: userId })
    .sort({ lastMessageAt: -1 })
    .limit(Math.min(Number(limit) || 30, MAX_PAGE))
    .populate('participants', 'username profile.displayName profile.avatar lastSeenAt');

  return conversations.map((c) => {
    const others = c.participants.filter((p) => String(p._id) !== String(userId));
    return {
      id: c._id,
      type: c.type,
      // The inbox shows the other person, never the full participant list.
      with: others.map((p) => ({
        id: p._id,
        username: p.username,
        displayName: p.profile?.displayName,
        avatar: p.profile?.avatar,
        lastSeenAt: p.lastSeenAt,
      })),
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.lastMessagePreview,
      unread: c.unread?.get(String(userId)) || 0,
    };
  });
}

async function listMessages(conversationId, userId, { limit = 30, before } = {}) {
  await loadForParticipant(conversationId, userId);

  const query = { conversation: conversationId };
  // Cursor pagination on createdAt rather than skip: new messages arriving
  // while the user scrolls would otherwise shift the window and repeat items.
  if (before) query.createdAt = { $lt: new Date(before) };

  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 30, MAX_PAGE))
    .populate('sender', 'username profile.displayName profile.avatar');

  // Fetched newest-first for the cursor, returned oldest-first for display.
  return messages.reverse().map(serializeMessage);
}

function serializeMessage(m) {
  const senderId = m.sender?._id || m.sender;
  const deliveredTo = (m.deliveredTo || []).map(String);
  const readTo = (m.readTo || []).map(String);

  // El estado se deriva de las listas y se resume en un solo campo para que el
  // cliente no tenga que recalcularlo. Se excluye al emisor: que el propio
  // mensaje esté en `readTo` por su autor no significa que el otro lo haya leído.
  let status = 'sent';
  const others = [...deliveredTo, ...readTo].filter((id) => id !== String(senderId));
  if (readTo.some((id) => id !== String(senderId))) status = 'read';
  else if (others.length > 0) status = 'delivered';

  return {
    id: m._id,
    conversation: m.conversation,
    sender: m.sender
      ? {
          id: m.sender._id,
          username: m.sender.username,
          displayName: m.sender.profile?.displayName,
          avatar: m.sender.profile?.avatar,
        }
      : null,
    kind: m.kind || 'text',
    call: m.call
      ? {
          kind: m.call.kind,
          status: m.call.status,
          durationSeconds: m.call.durationSeconds || 0,
        }
      : null,
    text: m.deletedAt ? '' : m.text || '',
    deleted: Boolean(m.deletedAt),
    status,
    createdAt: m.createdAt,
  };
}

// Persists a message and updates the conversation's denormalised preview and
// unread counters in one place, so both the REST endpoint and the websocket
// produce identical state.
async function sendMessage({ conversationId, senderId, text }) {
  const body = String(text || '').trim();
  if (!body) throw new HttpError(400, 'El mensaje no puede estar vacío');

  const conversation = await loadForParticipant(conversationId, senderId);

  const message = await Message.create({
    conversation: conversation._id,
    sender: senderId,
    text: body,
  });

  const unread = new Map(conversation.unread || []);
  for (const participant of conversation.participants) {
    const id = String(participant);
    // The sender's own view of the thread is never "unread".
    if (id === String(senderId)) continue;
    unread.set(id, (unread.get(id) || 0) + 1);
  }

  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessagePreview = body.slice(0, 140);
  conversation.unread = unread;
  await conversation.save();

  await message.populate('sender', 'username profile.displayName profile.avatar');

  // `participants` is returned so the socket layer can fan out a notification to
  // each recipient's personal room without re-reading the conversation.
  return {
    message: serializeMessage(message),
    conversationId: conversation._id,
    participants: conversation.participants.map(String),
  };
}

// Clears the caller's unread badge. Scoped to the caller so one participant
// cannot mark another's messages as read.
//
// Además de poner el contador a cero, marca como leídos los mensajes del otro
// (los que aún no lo estaban) y devuelve sus ids para que el socket pueda
// avisar al emisor y sus ticks pasen a azul.
async function markRead(conversationId, userId) {
  const conversation = await loadForParticipant(conversationId, userId);

  const unread = new Map(conversation.unread || {});
  unread.set(String(userId), 0);
  conversation.unread = unread;
  await conversation.save();

  const result = await Message.updateMany(
    {
      conversation: conversation._id,
      sender: { $ne: userId },
      readTo: { $ne: userId },
    },
    {
      $addToSet: { readTo: userId, deliveredTo: userId },
    }
  );

  const readIds = result.modifiedCount
    ? (
        await Message.find({
          conversation: conversation._id,
          sender: { $ne: userId },
          readTo: userId,
        }).select('_id')
      ).map((m) => String(m._id))
    : [];

  return { read: true, readIds };
}

// Marca como entregados los mensajes del otro que aún no lo estuvieran. Se llama
// cuando un socket del destinatario recibe el mensaje, para que el emisor vea el
// segundo tick sin que el otro tenga que abrir el hilo.
async function markDelivered(conversationId, userId) {
  const conversation = await loadForParticipant(conversationId, userId);

  const result = await Message.updateMany(
    {
      conversation: conversation._id,
      sender: { $ne: userId },
      deliveredTo: { $ne: userId },
    },
    { $addToSet: { deliveredTo: userId } }
  );

  if (!result.modifiedCount) return { deliveredIds: [] };

  const deliveredIds = (
    await Message.find({
      conversation: conversation._id,
      sender: { $ne: userId },
      deliveredTo: userId,
    }).select('_id')
  ).map((m) => String(m._id));

  return { deliveredIds };
}

// Etiqueta que ve el usuario en la vista previa de la bandeja. La llamada se
// resume igual que un mensaje de texto para que la lista no tenga que saber
// interpretar el estado.
function callPreview({ kind, status, durationSeconds }) {
  const label = kind === 'video' ? 'Videollamada' : 'Llamada';
  if (status === 'answered') {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${label} de ${mins}:${String(secs).padStart(2, '0')}`;
  }
  if (status === 'declined') return `${label} rechazada`;
  if (status === 'cancelled') return `${label} cancelada`;
  if (status === 'unreachable') return `${label} no disponible`;
  return `${label} perdida`;
}

// Registra una llamada en el hilo como una entrada más. Comparte la misma
// actualización de la conversación que un mensaje de texto (última actividad,
// vista previa y no leídos), así que una llamada perdida también sube el badge.
//
// `senderId` es quien inicia la llamada; el otro participante recibe el no
// leído. El estado describe cómo acabó, no quién llamó: una llamada "perdida"
// para quien la recibe sigue siendo una saliente en el historial de quien llamó.
async function recordCall({
  conversationId,
  senderId,
  kind = 'audio',
  status,
  durationSeconds = 0,
}) {
  const conversation = await loadForParticipant(conversationId, senderId);

  const callKind = kind === 'video' ? 'video' : 'audio';
  const callStatus = ['answered', 'missed', 'declined', 'cancelled', 'unreachable'].includes(status)
    ? status
    : 'missed';

  // Un 0 o un valor negativo en una llamada contestada sería un registro
  // incoherente; se recorta a un entero de segundos no negativo.
  const duration = callStatus === 'answered' ? Math.max(0, Math.floor(Number(durationSeconds) || 0)) : 0;

  const message = await Message.create({
    conversation: conversation._id,
    sender: senderId,
    kind: 'call',
    call: { kind: callKind, status: callStatus, durationSeconds: duration },
  });

  const preview = callPreview({ kind: callKind, status: callStatus, durationSeconds: duration });

  const unread = new Map(conversation.unread || []);
  for (const participant of conversation.participants) {
    const id = String(participant);
    if (id === String(senderId)) continue;
    unread.set(id, (unread.get(id) || 0) + 1);
  }

  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessagePreview = preview.slice(0, 140);
  conversation.unread = unread;
  await conversation.save();

  await message.populate('sender', 'username profile.displayName profile.avatar');

  return {
    message: serializeMessage(message),
    conversationId: conversation._id,
    participants: conversation.participants.map(String),
  };
}

// Ids de los participantes de una conversación, para que la capa de rutas pueda
// avisar a los demás sin volver a leer el documento.
async function participantsOf(conversationId) {
  const conversation = await Conversation.findById(conversationId).select('participants');
  return conversation ? conversation.participants.map(String) : [];
}

// Presencia de los demás participantes: si están en línea y, si no, cuándo se
// les vio por última vez. La parte "en línea" la resuelve el socket, que es
// quien sabe qué conexiones hay abiertas; aquí solo se lee la hora guardada.
async function presenceOf(conversationId, userId) {
  const conversation = await loadForParticipant(conversationId, userId);
  const others = conversation.participants.filter((p) => String(p) !== String(userId));
  const users = await User.find({ _id: { $in: others } }).select('username lastSeenAt');

  return users.map((u) => ({
    userId: String(u._id),
    username: u.username,
    lastSeenAt: u.lastSeenAt,
  }));
}

module.exports = {
  loadForParticipant,
  findOrCreateDirect,
  listConversations,
  listMessages,
  sendMessage,
  recordCall,
  markRead,
  markDelivered,
  participantsOf,
  presenceOf,
  serializeMessage,
  MAX_PAGE,
};
