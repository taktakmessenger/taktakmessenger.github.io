// Mantiene despierto el servicio gratuito de Render.
//
// Render duerme un servicio web gratuito tras 15 minutos sin tráfico de
// entrada, y la siguiente visita espera alrededor de un minuto a que arranque.
// Este contenedor pide la aplicación cada pocos minutos para que el servicio
// cuente actividad y no se duerma.
//
// Va como servicio aparte, y no como un temporizador dentro de la API, por una
// razón concreta: Render apaga las instancias que duerme y no vuelven a
// ejecutar nada hasta que entra una petición. Un `setInterval` dentro del
// proceso muere con él y nunca podría despertarlo. Un contenedor independiente
// sigue vivo y es quien genera la petición que lo despierta.
//
// Es un aviso en la primera pasada si la app tarda en responder (arranque en
// frío) y luego solo registra los fallos, para no llenar el log.
// La URL se puede dar entera (KEEPALIVE_URL) o como base más ruta. Preferir la
// base es más robusto: en Render se rellena sola desde la URL del servicio web
// (fromService), así que renombrar el servicio no deja el keep-alive apuntando a
// un host que ya no existe, que es un fallo silencioso: el servicio se dormiría
// y nadie se enteraría.
const base = (
  process.env.KEEPALIVE_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:4000'
).replace(/\/+$/, '');
const path = process.env.KEEPALIVE_PATH || '/health';
const url = process.env.KEEPALIVE_URL || `${base}${path}`;
const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000);
const timeoutMs = Number(process.env.KEEPALIVE_TIMEOUT_MS || 30000);

console.log(`[keepalive] ${url} cada ${Math.round(intervalMs / 1000)} s`);

let failures = 0;

async function ping() {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      // Sin caché: una respuesta servida de caché no cuenta como tráfico.
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - startedAt;
    if (!response.ok) {
      failures += 1;
      console.warn(`[keepalive] ${response.status} en ${ms} ms (fallo ${failures})`);
      return;
    }
    failures = 0;
    console.log(`[keepalive] ${response.status} en ${ms} ms`);
  } catch (error) {
    failures += 1;
    // El primer fallo puede ser un arranque en frío, que es justo lo que este
    // servicio existe para provocar. No es un error hasta que se repite.
    console.warn(`[keepalive] sin respuesta (${error.message}) (fallo ${failures})`);
  }
}

ping();
setInterval(ping, intervalMs);
