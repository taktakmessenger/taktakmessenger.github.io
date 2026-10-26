// Transcripción de notas de voz en el servidor.
//
// Es la ruta buena para transcribir una nota de voz: el archivo ya está en el
// servidor, así que no hace falta reproducirlo en alto para que el micrófono lo
// oiga (que es lo que tiene que hacer el respaldo del navegador). Con auriculares
// o en un sitio silencioso, el respaldo simplemente no sirve.
//
// El proveedor es opcional, como el de traducción. Sin `STT_PROVIDER`, la ruta
// responde 503 con un mensaje claro y el cliente cae al reconocimiento local: la
// función sigue existiendo, solo que peor.
//
// Seguridad: este servicio NUNCA descarga una URL que le llegue del cliente. El
// adjunto se identifica por su ruta relativa, se comprueba que cae dentro de la
// carpeta de adjuntos del chat, y el archivo se lee del disco. Sin eso, el
// endpoint sería un SSRF con el que recorrer la red interna desde el servidor.

const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');
const { HttpError } = require('../utils/http');

// Formatos que los proveedores aceptan sin conversión. Un webm/opus (lo que graba
// Chrome) y un mp4/aac (Safari) son los dos casos reales de esta app.
const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.mp4', '.m4a', '.webm', '.wav', '.ogg', '.oga', '.opus', '.weba', '.aac']);

// Tipos MIME por extensión, para la parte multipart de la petición al proveedor.
const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  '.aac': 'audio/aac',
};

/**
 * Resuelve la ruta de un adjunto del chat a un archivo real dentro de la carpeta
 * de subidas, o lanza si se sale de ella.
 *
 * La comprobación de prefijo es la que impide un `../` que saque al servidor de
 * su carpeta y lea, por ejemplo, `/etc/passwd`. `path.resolve` normaliza antes de
 * comparar, así que `uploads/chat/../../../etc/passwd` no cuela.
 */
function resolveAttachmentPath(url) {
  const raw = String(url || '').trim();
  if (!raw) throw new HttpError(400, 'Falta el adjunto');

  // Solo se aceptan rutas relativas de la app. Una URL absoluta (`http://…`) se
  // rechaza de plano: es justo el caso que convertiría esto en un SSRF.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    throw new HttpError(400, 'Adjunto no válido');
  }

  // Se quita el prefijo público `/uploads/` si lo lleva, para quedarse con la
  // ruta dentro de la carpeta de subidas.
  const withoutPrefix = raw.replace(/^\/?uploads\//i, '').replace(/^\/+/, '');
  const uploadsRoot = path.resolve(env.uploadsDir);
  const chatRoot = path.join(uploadsRoot, 'chat');
  const resolved = path.resolve(uploadsRoot, withoutPrefix);

  const withinChat = resolved === chatRoot || resolved.startsWith(`${chatRoot}${path.sep}`);
  if (!withinChat) throw new HttpError(400, 'Adjunto no válido');

  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new HttpError(400, 'Ese audio no se puede transcribir');
  }

  return { filePath: resolved, ext, mime: MIME_BY_EXT[ext] || 'application/octet-stream' };
}

/**
 * Envía el archivo al proveedor y devuelve el texto.
 * `openai` usa el endpoint compatible con Whisper; `deepgram` acepta el audio
 * crudo en el cuerpo. Se dejan los dos porque son los más comunes y su forma de
 * autenticación es distinta, que es justo lo que se rompe al integrar.
 */
async function transcribeWithProvider({ filePath, ext, mime, language }) {
  const provider = String(env.sttProvider || '').toLowerCase();
  const buffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);

  if (provider === 'openai') {
    const base = env.translateApiBase || 'https://api.openai.com/v1';
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), fileName);
    form.append('model', process.env.STT_MODEL || 'whisper-1');
    if (language) form.append('language', language.split('-')[0]);

    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.sttApiKey}` },
      body: form,
    });
    if (res.status === 429) throw new HttpError(429, 'El transcriptor está saturado, prueba en un momento');
    if (!res.ok) throw new HttpError(502, 'No se pudo transcribir la nota de voz');
    const data = await res.json();
    if (!data?.text) throw new HttpError(502, 'El transcriptor devolvió una respuesta vacía');
    return { text: String(data.text).trim(), language: language || null };
  }

  if (provider === 'deepgram') {
    const base = env.translateApiBase || 'https://api.deepgram.com/v1';
    const params = new URLSearchParams({ model: process.env.STT_MODEL || 'nova-2', smart_format: 'true' });
    if (language) params.set('language', language.split('-')[0]);

    const res = await fetch(`${base}/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.sttApiKey}`,
        'Content-Type': mime,
      },
      body: buffer,
    });
    if (res.status === 429) throw new HttpError(429, 'El transcriptor está saturado, prueba en un momento');
    if (!res.ok) throw new HttpError(502, 'No se pudo transcribir la nota de voz');

    const data = await res.json();
    const alternative = data?.results?.channels?.[0]?.alternatives?.[0];
    if (!alternative?.transcript) throw new HttpError(502, 'El transcriptor devolvió una respuesta vacía');
    return {
      text: String(alternative.transcript).trim(),
      language: data?.results?.channels?.[0]?.detected_language || language || null,
    };
  }

  throw new HttpError(503, 'La transcripción en el servidor no está configurada');
}

function isConfigured() {
  return Boolean(env.sttProvider && env.sttApiKey);
}

module.exports = {
  resolveAttachmentPath,
  transcribeWithProvider,
  isConfigured,
  SUPPORTED_EXTENSIONS,
};
