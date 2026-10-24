const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const pushService = require('./pushService');
const { HttpError } = require('../utils/http');

// Avisos de actividad: regalos, seguidores, me gusta y comentarios.
//
// Antes esto no existía y el efecto era que un regalo llegaba en silencio: el
// saldo del creador subía sin saber quién lo había mandado. Este servicio
// convierte cada acción en un aviso que el destinatario ve en el momento (por
// socket) o cuando vuelve a la app (por push).

// Cuántos avisos caben en una página de la lista.
const PAGE_SIZE = 20;

// Recorte del comentario que se guarda como vista previa. Se corta al guardar
// y no al mostrar, para que el texto largo no viaje ni ocupe en la base.
const PREVIEW_LENGTH = 120;

function preview(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1)}…` : clean;
}

// El socket y la presencia viven en `liveSockets`. Se cargan de forma perezosa
// para no crear un ciclo en tiempo de carga: `liveSockets` no necesita nada de
// aquí, pero si algún día lo hiciera, un `require` arriba rompería.
function liveSockets() {
  return require('./liveSockets');
}

/**
 * Crea un aviso y lo entrega.
 *
 * Nunca lanza: un aviso es información *sobre* una acción que ya ocurrió (el
 * regalo ya se cobró, el comentario ya se guardó). Que falle el aviso no puede
 * deshacer ni tumbar lo importante, así que se registra el error y se sigue.
 * Por eso mismo los llamadores pueden hacer `await` sin miedo: es determinista
 * en los tests y seguro en producción.
 *
 * Devuelve el aviso creado, o null si se descartó (acción propia) o falló.
 */
async function notify({
  recipientId,
  actorId,
  type,
  video = null,
  comment = null,
  post = null,
  amount = null,
  giftName = null,
  text = null,
}) {
  try {
    if (!recipientId || !actorId) return null;
    // Uno no se notifica a sí mismo. Sin esto, darse me gusta en el propio
    // vídeo llenaría la campana de avisos inútiles.
    if (String(recipientId) === String(actorId)) return null;
    if (!mongoose.isValidObjectId(recipientId) || !mongoose.isValidObjectId(actorId)) return null;

    const created = await Notification.create({
      recipient: recipientId,
      actor: actorId,
      type,
      video,
      comment,
      post,
      amount,
      giftName,
      preview: text ? preview(text) : null,
    });

    const populated = await created.populate([
      { path: 'actor', select: 'username profile.displayName profile.avatar' },
      { path: 'video', select: 'thumbnailUrl title' },
    ]);

    deliver(populated).catch(() => {});
    return populated;
  } catch (err) {
    console.error('[NOTIF] No se pudo crear el aviso:', err.message);
    return null;
  }
}

// Entrega por socket si el destinatario está conectado; si no, por push. Los dos
// a la vez sería duplicar: quien tiene la app abierta ya ve el aviso en vivo y
// no necesita que le vibre el teléfono por lo mismo.
async function deliver(notification) {
  const recipientId = String(notification.recipient);
  const io = liveSockets().getIo();
  const online = liveSockets().isOnline(recipientId);

  if (io && online) {
    io.to(`user:${recipientId}`).emit('notification:new', toPublic(notification));
    return;
  }

  // Sin socket (o sin io, como en los tests de API) queda el push. Si tampoco
  // hay push configurado, el aviso espera en la lista: no se pierde, se ve al
  // abrir la app.
  await pushService.sendToUser(recipientId, activityPayload(notification));
}

// Payload del push. Se manda poco y sin datos sensibles: el contenido se enseña
// en una pantalla de bloqueo, así que el nombre de quien actuó sí va (es lo que
// da sentido al aviso) pero nada más.
function activityPayload(notification) {
  const actor = notification.actor?.username ? `@${notification.actor.username}` : 'Alguien';
  const body = {
    gift: notification.giftName
      ? `Te envió ${notification.giftName}`
      : 'Te envió un regalo',
    follow: 'Empezó a seguirte',
    like: 'Le gustó tu vídeo',
    comment: notification.preview ? `Comentó: ${notification.preview}` : 'Comentó tu vídeo',
    reply: notification.preview ? `Respondió: ${notification.preview}` : 'Respondió tu comentario',
    post_like: 'Le gustó tu publicación',
    post_comment: notification.preview
      ? `Comentó tu publicación: ${notification.preview}`
      : 'Comentó tu publicación',
  }[notification.type] || 'Tienes actividad nueva';

  return {
    type: 'activity',
    title: actor,
    body,
    // Etiqueta por tipo y actor: dos regalos seguidos del mismo fan se agrupan
    // en una sola notificación en vez de apilarse.
    tag: `activity-${notification.type}-${notification.actor?._id || notification.actor}`,
    data: {
      url: notification.type.startsWith('post_') ? '/?view=wall' : '/?view=activity',
      type: notification.type,
    },
  };
}

// Forma pública del aviso. Se aplana el actor y el vídeo para que la pantalla
// no tenga que navegar el documento de Mongoose.
function toPublic(notification) {
  const doc = notification.toObject ? notification.toObject() : notification;
  return {
    _id: doc._id,
    type: doc.type,
    read: Boolean(doc.read),
    amount: doc.amount,
    giftName: doc.giftName,
    preview: doc.preview,
    createdAt: doc.createdAt,
    actor: doc.actor && typeof doc.actor === 'object'
      ? {
          _id: doc.actor._id,
          username: doc.actor.username,
          displayName: doc.actor.profile?.displayName || null,
          avatar: doc.actor.profile?.avatar || null,
        }
      : doc.actor,
    video: doc.video && typeof doc.video === 'object'
      ? {
          _id: doc.video._id,
          thumbnailUrl: doc.video.thumbnailUrl || null,
          title: doc.video.title || null,
        }
      : doc.video,
    comment: doc.comment,
    post: doc.post || null,
  };
}

// Lista paginada por `createdAt` (keyset). Un `skip` se degrada con el tiempo:
// la página 50 de un usuario muy activo recorrería miles de documentos.
async function listForUser({ userId, cursor, limit = PAGE_SIZE }) {
  const safeLimit = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 50);
  const query = { recipient: userId };
  if (cursor) {
    const at = new Date(cursor);
    if (!Number.isNaN(at.getTime())) query.createdAt = { $lt: at };
  }

  // Se pide uno de más para saber si hay página siguiente sin contar el total.
  const rows = await Notification.find(query)
    .sort({ createdAt: -1 })
    .limit(safeLimit + 1)
    .populate('actor', 'username profile.displayName profile.avatar')
    .populate('video', 'thumbnailUrl title');

  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;

  return {
    notifications: page.map(toPublic),
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    unread: await unreadCount(userId),
  };
}

function unreadCount(userId) {
  return Notification.countDocuments({ recipient: userId, read: false });
}

// Marca una página entera como leída. Se hace en bloque porque el gesto real es
// "abrir la campana", no ir marcando uno a uno.
async function markAllRead(userId) {
  await Notification.updateMany({ recipient: userId, read: false }, { $set: { read: true } });
  return { unread: 0 };
}

async function markRead({ userId, id }) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Aviso no encontrado');
  // El filtro por `recipient` es lo que impide marcar como leído el aviso de
  // otra persona pasando su id.
  const result = await Notification.updateOne(
    { _id: id, recipient: userId },
    { $set: { read: true } }
  );
  if (result.matchedCount === 0) throw new HttpError(404, 'Aviso no encontrado');
  return { unread: await unreadCount(userId) };
}

module.exports = {
  notify,
  listForUser,
  unreadCount,
  markAllRead,
  markRead,
  toPublic,
  activityPayload,
  PAGE_SIZE,
};
