import api from '../api/client';

/**
 * Suscripción a notificaciones push.
 *
 * Es lo que permite que una llamada suene cuando la app está cerrada: el
 * service worker recibe el push del servidor y muestra la llamada. Sin esto,
 * al otro solo se le puede decir "no está disponible".
 *
 * Tres cosas que cuesta descubrir y están resueltas aquí:
 *
 *  - En iOS los push web solo existen desde 16.4 y **solo si la app está
 *    añadida a la pantalla de inicio**. En Safari normal, `PushManager` no
 *    existe y no hay nada que hacer: se informa y ya está.
 *  - El permiso de notificación solo se puede pedir **una vez** en iOS. Pedirlo
 *    antes de saber si el servidor tiene claves VAPID lo gastaría en balde, así
 *    que primero se pregunta a `/push/config`.
 *  - La suscripción hay que reenviarla al servidor tras cada inicio de sesión:
 *    el navegador la conserva, pero el servidor necesita asociarla a la cuenta
 *    que acaba de entrar (por ejemplo, si antes entró otra persona).
 */

// `applicationServerKey` en la suscripción espera bytes, no la cadena base64url
// que se pega en la configuración.
function urlBase64ToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * iOS permite push web solo en apps instaladas en la pantalla de inicio. Se
 * detecta por `display-mode: standalone`: en Safari a pantalla completa es
 * false, aunque se haya instalado, hasta que se abre desde el icono.
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

async function registerServiceWorker() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/**
 * Pide permiso y suscribe este dispositivo. Devuelve el resultado para que la
 * UI pueda explicar qué pasó en vez de dejar un botón que no hace nada.
 */
export async function subscribeToPush() {
  if (!pushSupported()) {
    return {
      ok: false,
      reason: isIos() && !isStandalone() ? 'ios_needs_install' : 'unsupported',
    };
  }

  // Primero, ¿hay servidor de push en este despliegue? Si no, no se pide
  // permiso: gastarlo complicaría reintentar cuando sí lo haya.
  let config;
  try {
    ({ data: config } = await api.get('/push/config'));
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!config.available || !config.publicKey) {
    return { ok: false, reason: 'unavailable' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' };
  }

  try {
    const registration = await registerServiceWorker();
    // `ready` espera a que el service worker esté activo: `subscribe` sobre un
    // registro que aún no controla la página falla.
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        // Exigido por los navegadores: el push debe ser visible para el usuario.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      }));

    await api.post('/push/subscribe', { subscription: subscription.toJSON() });
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: 'error', message: err.message };
  }
}

/**
 * Reenvía al servidor la suscripción que el navegador ya tenía.
 *
 * Se llama al iniciar sesión. Es necesario porque el servidor guarda qué
 * dispositivo pertenece a qué cuenta: si no se reenvía, tras cambiar de usuario
 * las llamadas sonarían en el teléfono equivocado.
 */
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await api.post('/push/subscribe', { subscription: subscription.toJSON() });
  } catch {
    // No es crítico: si falla, la app funciona igual, solo no sonará cerrada.
  }
}

export async function unsubscribeFromPush() {
  if (!pushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    // Se avisa al servidor y luego se borra en el navegador. En ese orden: si
    // se borrara primero, el servidor seguiría con una suscripción muerta.
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  } catch {
    // Al cerrar sesión no se debe bloquear por esto.
  }
}

/**
 * Desvincula este dispositivo de la cuenta, sin borrar la suscripción del
 * navegador.
 *
 * Se usa al cerrar sesión. Hay que hacerlo: si no, el servidor seguiría
 * mandando a este teléfono las llamadas de quien acaba de salir. Pero la
 * suscripción del navegador se conserva a propósito, para que al volver a
 * entrar `syncPushSubscription` la reasocie sola y el usuario no tenga que
 * reactivar las notificaciones cada vez que inicia sesión.
 */
export async function detachPushSubscription() {
  if (!pushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
  } catch {
    // Cerrar sesión nunca debe fallar por una notificación.
  }
}

/**
 * Lanza el service worker al arrancar, sin pedir permiso.
 *
 * Así queda registrado y listo para cuando el usuario active las
 * notificaciones, y el navegador puede entregar un push en cuanto se suscriba.
 */
export async function ensureServiceWorker() {
  if (!pushSupported()) return null;
  try {
    return await registerServiceWorker();
  } catch {
    return null;
  }
}
