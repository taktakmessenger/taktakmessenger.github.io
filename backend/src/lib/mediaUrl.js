const env = require('../config/env');

// El bucket de medios (R2) no manda cabeceras CORS. hls.js carga la lista HLS y
// sus segmentos por XHR, así que pedidos al bucket el navegador los bloquea
// ("Failed to fetch") y el vídeo se queda en negro. Servirlos por el proxy
// propio (`/media/...`) los convierte en una petición del mismo origen y el
// CORS deja de importar.
//
// Solo se reescribe la escalera HLS. El fichero original (mp4/webm) lo carga el
// propio `<video>`, que no usa XHR: pedirlo directo al bucket conserva los
// rangos HTTP que R2 sirve mejor que el proxy.
function toProxyUrl(url) {
  const base = env.r2?.publicBaseUrl;
  if (!base || typeof url !== 'string' || !url.startsWith(`${base}/`)) return url;
  return `/media/${url.slice(base.length + 1)}`;
}

module.exports = { toProxyUrl };
