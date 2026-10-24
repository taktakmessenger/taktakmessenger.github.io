const path = require('path');
const crypto = require('crypto');

// Tipos de archivo que se pueden adjuntar en un chat, agrupados por cómo se
// pintan. La lista es una allowlist a propósito: aceptar lo que no se conoce es
// la vía habitual para colar un archivo que el navegador ejecuta.
//
// Se mira la extensión, no el MIME que declara el cliente: el MIME lo elige
// quien sube el archivo y no es de fiar.
const KINDS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'],
  video: ['.mp4', '.webm', '.mov', '.m4v', '.ogv'],
  audio: ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.weba'],
  file: ['.pdf', '.txt', '.csv', '.md', '.json', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
};

// Extensiones que el navegador interpreta como documento o script. Servidas
// desde el mismo dominio que la app, serían un XSS almacenado: quien las sube
// ejecutaría código en la sesión de quien las abre. No entran en la allowlist,
// y además se fuerzan a descarga al servirlas.
const FORBIDDEN = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml', '.js', '.mjs', '.cjs',
  '.css', '.swf', '.jar', '.app', '.exe', '.msi', '.bat', '.cmd', '.com',
  '.scr', '.ps1', '.sh', '.php', '.phtml', '.htaccess',
]);

// Tipo lógico a partir de la extensión. Devuelve null si no está permitida.
function kindOfExtension(ext) {
  const lower = String(ext || '').toLowerCase();
  if (FORBIDDEN.has(lower)) return null;
  for (const [kind, extensions] of Object.entries(KINDS)) {
    if (extensions.includes(lower)) return kind;
  }
  return null;
}

// Nombre con el que se sirve el archivo. Se toma del original pero se limpia:
// un nombre con `/`, `..` o caracteres de control podría usarse para escribir
// fuera de la carpeta de subidas o para romper la cabecera de descarga.
//
// Se conservan los acentos y la eñe: son letras normales en un nombre y
// borrarlas dejaría "añó.pdf" en "a__.pdf", irreconocible para quien lo recibe.
function safeName(originalName) {
  const base = path.basename(String(originalName || 'archivo'));
  const cleaned = base
    // Caracteres de control y saltos de línea: romperían la cabecera HTTP.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Reservados en sistemas de archivos y peligrosos en una cabecera.
    .replace(/[\\/:*?"<>|]/g, '_')
    // Espacios: se sustituyen para evitar ambigüedades al citar el nombre.
    .replace(/\s+/g, '_')
    // Puntos iniciales: ocultarían el archivo o insinuarían una ruta relativa.
    .replace(/^\.+/, '_');
  return (cleaned || 'archivo').slice(0, 120);
}

// Nombre único en disco, conservando la extensión para que el tipo se pueda
// volver a deducir al servir el archivo.
function storedName(originalName) {
  const ext = path.extname(safeName(originalName)).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

// Cabecera `Content-Disposition`. Las imágenes, el vídeo y el audio se muestran
// en línea (es lo que se espera de un chat); el resto se descarga.
function attachmentDisposition(kind, name) {
  const inline = kind === 'image' || kind === 'video' || kind === 'audio';
  const fallback = safeName(name);
  // Se envían las dos formas: `filename` para los navegadores antiguos y
  // `filename*` (UTF-8) para los modernos.
  const encoded = encodeURIComponent(fallback);
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Tamaño máximo por tipo. Una imagen no necesita lo mismo que un vídeo, y un
// límite único obligaría a permitir 50 MB para todos.
const MAX_BYTES = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  file: 20 * 1024 * 1024,
};

function maxBytesFor(kind) {
  return MAX_BYTES[kind] || MAX_BYTES.file;
}

// Comprueba el archivo antes de aceptarlo. Devuelve `{ kind, ext }` o lanza un
// error con un mensaje que se puede mostrar tal cual.
function validateAttachment(file) {
  if (!file) throw new Error('No se recibió ningún archivo');

  const ext = path.extname(safeName(file.originalname)).toLowerCase();
  if (FORBIDDEN.has(ext)) {
    throw new Error('Ese tipo de archivo no está permitido por seguridad');
  }

  const kind = kindOfExtension(ext);
  if (!kind) {
    throw new Error('Tipo de archivo no soportado');
  }

  const limit = maxBytesFor(kind);
  if (file.size > limit) {
    const mb = Math.round(limit / (1024 * 1024));
    throw new Error(`El archivo supera el máximo de ${mb} MB`);
  }

  return { kind, ext };
}

module.exports = {
  KINDS,
  FORBIDDEN,
  MAX_BYTES,
  kindOfExtension,
  safeName,
  storedName,
  attachmentDisposition,
  maxBytesFor,
  validateAttachment,
};
