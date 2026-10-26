// Qué vídeos se aceptan al subir. Vive aparte de la ruta para poder probarlo
// sin levantar el servidor.
//
// El MIME lo pone el navegador y no siempre es fiable: hay móviles y
// grabadores que mandan `application/octet-stream` o no mandan nada. Rechazar
// por MIME a secas dejaba fuera vídeos válidos (sobre todo grabaciones de
// Android en 3GP), así que cuando el MIME es genérico se decide por la
// extensión, que es lo único que queda.

// Formatos que graban los móviles (MP4/MOV de iPhone, 3GP de Android) y que
// exportan los editores (MKV, AVI, OGV).
const VIDEO_MIME =
  /^video\/(mp4|webm|quicktime|x-matroska|x-msvideo|3gpp|3gpp2|ogg|ogv|mpeg|mp2t|x-m4v|x-flv|avi)$/;

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|3g2|ogv|ogg|mpg|mpeg|m2ts|ts|flv)$/i;

// MIME sin información de tipo: se cae a la extensión. `application/mp4` entra
// aquí porque algunos navegadores lo mandan en vez de `video/mp4`.
const GENERIC_MIME = /^(application\/octet-stream|binary\/octet-stream|application\/mp4)$/;

function isAcceptedVideo({ mimetype, originalname } = {}) {
  const mime = (mimetype || '').toLowerCase();
  if (VIDEO_MIME.test(mime)) return true;
  if (mime && !GENERIC_MIME.test(mime)) return false;
  return VIDEO_EXT.test(originalname || '');
}

module.exports = { isAcceptedVideo, VIDEO_MIME, VIDEO_EXT, GENERIC_MIME };
