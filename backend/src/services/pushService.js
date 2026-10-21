const webpush = require('web-push');
const env = require('../config/env');
const PushSubscription = require('../models/PushSubscription');

/**
 * Web Push: lo que hace que una llamada suene aunque la app esté cerrada.
 *
 * Sin esto, cuando el otro no tiene el socket abierto la llamada se queda en
 * "no está disponible". Con esto, el servicio de push (FCM en Android/Chrome,
 * APNs en iOS, Mozilla en Firefox) despierta la app y la llamada entra.
 *
 * Es la misma pieza que usa WhatsApp, con una diferencia importante que no se
 * puede esquivar con código: WhatsApp tiene app nativa y por eso despierta el
 * teléfono siempre. Aquí:
 *
 *  - Android y escritorio: funciona con la app cerrada.
 *  - iPhone: solo desde iOS 16.4 y **solo si la app está añadida a la pantalla
 *    de inicio** (Añadir a inicio). En Safari normal iOS no entrega push.
 *
 * Si no hay claves VAPID configuradas, `isConfigured()` es false y el servidor
 * no intenta nada: es preferible decir "no disponible" que fingir que se envió
 * una notificación que nunca llegará.
 */

let ready = false;

function isConfigured() {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

function ensureReady() {
  if (ready || !isConfigured()) return;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  ready = true;
}

/**
 * Guarda (o refresca) la suscripción de un dispositivo.
 *
 * El `upsert` por `endpoint` es lo que evita duplicados: si el mismo navegador
 * vuelve a suscribirse, se actualiza la clave y el dueño en lugar de crear otra
 * fila. El endpoint es único, así que un `upsert` sin más podría reasignar a
 * otro usuario una suscripción ajena si alguien la reutilizara — por eso el
 * endpoint solo se acepta del propio usuario autenticado, que es quien lo
 * generó en su navegador.
 */
async function saveSubscription({ userId, subscription, userAgent }) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Suscripción incompleta');
  }

  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: userId,
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
      lastUsedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function removeSubscription({ userId, endpoint }) {
  // Se filtra también por usuario: borrar por endpoint a secas permitiría a
  // cualquiera desuscribir el dispositivo de otro conociendo su endpoint.
  await PushSubscription.deleteOne({ user: userId, endpoint });
}

/**
 * Envía una notificación a todos los dispositivos de un usuario.
 *
 * Devuelve cuántos envíos salieron bien. No lanza: que un dispositivo falle no
 * debe impedir que suene en los demás, y la llamada ya está en marcha.
 *
 * Una suscripción caducada responde 404/410 y se borra en el momento: son
 * cientos acumulándose con el tiempo y dejarlas ahí hace cada llamada más lenta.
 */
async function sendToUser(userId, payload) {
  if (!isConfigured()) return { sent: 0, total: 0 };

  ensureReady();

  const subs = await PushSubscription.find({ user: userId });
  if (subs.length === 0) return { sent: 0, total: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          },
          body
        );
        sent += 1;
        sub.lastUsedAt = new Date();
        await sub.save();
      } catch (err) {
        // 404/410 = el navegador retiró la suscripción (app desinstalada, datos
        // borrados). Es lo definitivo; el resto puede ser un fallo pasajero.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          console.error('[PUSH] Envío fallido:', err.statusCode || err.message);
        }
      }
    })
  );

  return { sent, total: subs.length };
}

/**
 * Payload de una llamada entrante.
 *
 * Se manda poco y sin datos sensibles: el servicio de push transporta el
 * mensaje, y el contenido se muestra en una pantalla de bloqueo. Basta con
 * saber quién llama y cómo responder; los detalles se cargan al abrir la app.
 */
function incomingCallPayload({ from, kind, conversationId }) {
  return {
    type: 'call',
    title: `Llamada de @${from.username}`,
    body: kind === 'video' ? 'Videollamada entrante' : 'Llamada de voz entrante',
    // Etiqueta estable: una segunda llamada del mismo origen reemplaza la
    // notificación en vez de apilar otra.
    tag: `call-${from.id}`,
    // `requireInteraction` mantiene la notificación en pantalla hasta que se
    // actúe: una llamada no debe desvanecerse sola a los cinco segundos.
    requireInteraction: true,
    data: {
      url: `/?call=${from.id}&kind=${kind}&from=${encodeURIComponent(from.username)}`,
      fromId: String(from.id),
      kind,
      conversationId: conversationId || null,
    },
  };
}

module.exports = {
  isConfigured,
  saveSubscription,
  removeSubscription,
  sendToUser,
  incomingCallPayload,
};
