// Reproducción de un vídeo de TAK TAK, compartida por el feed y el perfil.
//
// Prefiere la escalera HLS cuando el transcodificado de fondo ya la produjo y
// cae al fichero original si no existe: así un vídeo recién subido se ve al
// momento y uno ya optimizado se adapta al ancho de banda. hls.js pesa ~500 kB,
// así que se carga solo cuando el vídeo realmente lo necesita, no en el arranque.
//
// Devuelve una función de limpieza que destruye el reproductor de hls.js. Sin
// ella, cada vídeo que se deja atrás seguiría descargando segmentos.
export function attachVideoSource(el, video) {
  if (!el || !video) return () => {};

  const source = video.hlsUrl || video.videoUrl;
  if (!source) return () => {};

  // Un fichero suelto (mp4/webm) lo reproduce el navegador directamente.
  if (!source.endsWith('.m3u8')) {
    el.src = source;
    return () => {};
  }

  let hls;
  let cancelled = false;

  // La escalera HLS se pide por XHR/fetch, y eso la somete a CORS: si el bucket
  // no manda `Access-Control-Allow-Origin`, hls.js la ve bloqueada y el
  // reproductor se queda en negro. El fichero original, en cambio, lo carga el
  // propio `<video>`, que no necesita CORS. Caer a él deja el vídeo visible
  // (con peor calidad y sin adaptación) en vez de en negro.
  const fallbackToOriginal = () => {
    if (cancelled || !video.videoUrl) return;
    try {
      hls?.destroy();
    } catch {
      // El reproductor ya estaba roto; el original se pone igual.
    }
    hls = null;
    if (el.src !== video.videoUrl) el.src = video.videoUrl;
  };

  import('hls.js')
    .then(({ default: Hls }) => {
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        // `fatal` cubre tanto un fallo de red (CORS, 404) como de parseo. Los
        // avisos no fatales los gestiona hls.js por su cuenta.
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) fallbackToOriginal();
        });
        hls.loadSource(source);
        hls.attachMedia(el);
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari reproduce HLS de forma nativa, sin hls.js.
        el.src = source;
      } else {
        fallbackToOriginal();
      }
    })
    .catch(() => {
      // Si el reproductor no se puede cargar, el original sigue siendo visible.
      if (!cancelled) fallbackToOriginal();
    });

  return () => {
    cancelled = true;
    hls?.destroy();
  };
}
