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

  import('hls.js')
    .then(({ default: Hls }) => {
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(source);
        hls.attachMedia(el);
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari reproduce HLS de forma nativa, sin hls.js.
        el.src = source;
      }
    })
    .catch(() => {
      // Si el reproductor no se puede cargar, el original sigue siendo visible.
      if (!cancelled) el.src = video.videoUrl;
    });

  return () => {
    cancelled = true;
    hls?.destroy();
  };
}
