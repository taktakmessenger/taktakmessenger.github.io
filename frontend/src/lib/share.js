// Compartir un vídeo. Se reúne aquí para que la hoja de compartir tenga una
// sola fuente del enlace y del texto, y para poder probar la lógica sin DOM.

// Enlace público de un vídeo. Apunta a la portada con `?video=<id>`, que la app
// lee al arrancar para abrir ese reel directamente. No se usa una ruta propia
// (`/video/<id>`) porque el servidor sirve una única página (SPA) y una ruta
// desconocida daría 404 antes de llegar al router del cliente.
export function videoShareUrl(videoId, origin = globalThis.location?.origin) {
  const base = origin || '';
  return `${base}/?video=${encodeURIComponent(videoId)}`;
}

// Texto que acompaña al enlace: quién lo publica y qué es. Sin esto, el enlace
// llega suelto en un chat y nadie sabe qué hay al otro lado.
export function shareMessage(video, origin = globalThis.location?.origin) {
  const author = video?.creator?.username ? `@${video.creator.username}` : 'alguien';
  const title = (video?.title || '').trim();
  const url = videoShareUrl(video?._id, origin);
  const head = title
    ? `Mira "${title}" de ${author} en TAK TAK`
    : `Mira este vídeo de ${author} en TAK TAK`;
  return `${head}: ${url}`;
}

// Copia al portapapeles. `navigator.clipboard` no existe en contextos no
// seguros (HTTP sin localhost) y puede ser rechazado por permisos, así que hay
// un respaldo con `execCommand('copy')`, hoy obsoleto pero aún el único camino
// en esos casos. Devuelve si el texto quedó copiado, para que la pantalla pueda
// avisar en vez de mentir con un "Copiado".
export async function copyToClipboard(text, nav = globalThis.navigator, doc = globalThis.document) {
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Se intenta el respaldo.
  }

  try {
    const area = doc.createElement('textarea');
    area.value = text;
    // Fuera de pantalla pero enfocable: `execCommand` no copia un elemento
    // oculto con `display: none`.
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand('copy');
    // La limpieza va aparte para que un fallo al retirar el nodo no borre un
    // copiado que sí ocurrió.
    try {
      area.remove();
    } catch {
      // Sin `remove` (navegadores muy antiguos) el nodo queda fuera de pantalla;
      // no merece fallar la operación por eso.
    }
    return ok;
  } catch {
    return false;
  }
}

// Comparte con el sistema operativo (WhatsApp, correo, lo que haya instalado).
// Devuelve `false` cuando la Web Share API no está disponible, para que la hoja
// caiga en "Copiar enlace" en lugar de quedarse en nada.
export async function shareWithSystem(video, nav = globalThis.navigator) {
  if (!nav?.share) return false;
  try {
    await nav.share({
      title: 'TAK TAK',
      text: shareMessage(video),
    });
    return true;
  } catch (err) {
    // Cancelar el diálogo del sistema no es un error que deba propagarse.
    if (err?.name === 'AbortError') return true;
    return false;
  }
}
