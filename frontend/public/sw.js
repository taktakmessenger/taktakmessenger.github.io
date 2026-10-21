/* Service worker de TAK TAK.
 *
 * Existe por una sola razón: recibir el push de una llamada entrante cuando la
 * app está cerrada o en segundo plano. Sin service worker no hay push, y sin
 * push una llamada a alguien desconectado no suena (que es justo lo que hace
 * WhatsApp y lo que se quiere aquí).
 *
 * Se mantiene deliberadamente pequeño: no cachea nada. Un service worker que
 * cachea el bundle se queda sirviendo una versión vieja de la app y confunde
 * más de lo que ayuda; para el push no hace falta caché.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Un push sin JSON válido no debe tumbar el worker: se ignora.
    return;
  }

  const isCall = payload.type === 'call';
  const title = payload.title || 'TAK TAK';
  const options = {
    body: payload.body || '',
    // El icono va en la raíz porque este fichero se sirve desde `/sw.js`.
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: payload.tag || undefined,
    // Una llamada se queda en pantalla hasta que se actúe; un aviso normal, no.
    requireInteraction: Boolean(payload.requireInteraction),
    data: payload.data || {},
    // Vibration API. En Android hace que el teléfono se note; en otros se ignora.
    vibrate: isCall ? [300, 200, 300, 200, 300] : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};

  // Pulsar la notificación abre la app en la pantalla de llamada entrante. Sin
  // esto el usuario tendría que buscar a mano a quien le llama mientras el
  // teléfono suena, que es justo lo que no se quiere.
  //
  // No hay acción de "Rechazar" en la notificación a propósito: la API usa
  // tokens Bearer que viven en `localStorage`, y el service worker no puede
  // leerlos, así que un rechazo desde aquí fallaría con 401 en silencio. Mejor
  // no ofrecer un botón que no funciona; la llamada caduca sola.
  const target = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Si ya hay una pestaña abierta, se reutiliza y se navega en ella: abrir
        // otra dejaría dos apps vivas compitiendo por la llamada.
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
