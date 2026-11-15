const dns = require('dns').promises;
const net = require('net');
const os = require('os');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const env = require('../config/env');
const storageService = require('./storageService');
const { HttpError } = require('../utils/http');

// Buscador de contenido con licencia libre. Reúne dos fuentes que no piden
// clave: Openverse (música CC de Jamendo, Freesound, Wikimedia…) y Wikimedia
// Commons (vídeo). La idea es la de siempre —encontrar algo fuera y traerlo a
// TAK TAK— pero sin descargar de sitios con derechos: lo que se ofrece aquí se
// puede reutilizar legalmente, que es lo único que hace sostenible una app
// pública.
//
// Nada de lo que devuelven estas funciones se sirve al navegador desde el origen
// original: se previsualiza por el proxy (`/api/discover/preview`) y, al
// importar, se copia al bucket. Así la CSP no se abre a media internet.

const USER_AGENT = 'TakTak/1.0 (+https://taktak.vip)';
const MAX_REDIRECTS = 3;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE_API = 'https://api.openverse.org/v1/audio/';

// Caché corta en memoria. El buscador dispara una petición por pausa al teclear
// y las mismas palabras se repiten ("beat", "lofi"): guardar la respuesta unos
// minutos evita golpear a las fuentes y acelera la segunda búsqueda.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// --- Guarda contra SSRF ------------------------------------------------
//
// El servidor descarga direcciones que manda el usuario. Sin comprobar a dónde
// apuntan, un enlace a los metadatos del proveedor (169.254.169.254) o a un
// servicio interno de la red de Render convertiría el buscador en un túnel hacia
// dentro. Se resuelve el nombre y se rechaza si CUALQUIER dirección es privada:
// un host que devuelva una pública y otra interna no cuela.

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / metadatos
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast y reservado
    return false;
  }
  const lower = String(ip).toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function assertPublicHost(hostname) {
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new HttpError(400, 'No se pudo resolver el enlace');
  }
  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw new HttpError(400, 'Ese enlace no apunta a internet');
  }
}

function parseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new HttpError(400, 'Enlace inválido');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Solo se admiten enlaces http o https');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new HttpError(400, 'Puerto no permitido');
  }
  return url;
}

// Abre el flujo remoto siguiendo redirecciones a mano: cada salto se vuelve a
// validar, porque un 302 es justo la forma de saltarse la comprobación inicial.
async function openStream(rawUrl, { timeoutMs = env.discover.timeoutMs } = {}) {
  let current = parseUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new HttpError(504, 'El origen tardó demasiado');
      throw new HttpError(502, 'No se pudo conectar con el origen');
    }
    clearTimeout(timer);

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (res.body) await res.body.cancel().catch(() => {});
      current = parseUrl(new URL(location, current).toString());
      continue;
    }
    if (!res.ok) {
      if (res.body) await res.body.cancel().catch(() => {});
      throw new HttpError(502, `El origen respondió ${res.status}`);
    }
    return { res, url: current };
  }

  throw new HttpError(502, 'Demasiadas redirecciones');
}

const EXT_BY_TYPE = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.m4a',
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function extensionFor(contentType, pathname) {
  const byType = EXT_BY_TYPE[contentType];
  if (byType) return byType;
  const ext = path.extname(String(pathname || '')).toLowerCase();
  // Solo extensiones que el bucket sabe etiquetar; cualquier otra se queda en
  // binario y el navegador no la reproduciría.
  return Object.values(EXT_BY_TYPE).includes(ext) ? ext : '.bin';
}

// Descarga a un fichero temporal con tope de tamaño. El tope se aplica mientras
// se escribe, no solo con `content-length`: el origen puede mentir en la
// cabecera o no mandarla.
async function downloadToTemp(rawUrl, { maxBytes = env.discover.maxBytes } = {}) {
  const { res, url } = await openStream(rawUrl);

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    if (res.body) await res.body.cancel().catch(() => {});
    throw new HttpError(413, 'El archivo es demasiado grande');
  }

  const contentType = String(res.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'taktak-discover-'));
  const filePath = path.join(dir, `file${extensionFor(contentType, url.pathname)}`);

  // El contador va dentro del `pipeline` como un Transform. Enganchar un
  // `on('data')` antes pone el stream en modo flujo y `pipeline` recibe los
  // datos a medias: la descarga se corta sola.
  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(new HttpError(413, 'El archivo es demasiado grande'));
      return cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), counter, fsSync.createWriteStream(filePath));
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'La descarga se interrumpió');
  }

  return { filePath, dir, contentType, size };
}

async function cleanup(dir) {
  if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// Copia el fichero descargado al almacenamiento definitivo (bucket o disco
// local en desarrollo) y devuelve la URL con la que se servirá.
async function storeDownloaded({ filePath, extension, prefix }) {
  const key = `${prefix}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  if (storageService.isConfigured()) {
    return storageService.putFile(filePath, key);
  }

  await fs.mkdir(env.uploadsDir, { recursive: true });
  const filename = path.basename(key);
  await fs.copyFile(filePath, path.join(env.uploadsDir, filename));
  return `/uploads/${filename}`;
}

// --- Fuentes ------------------------------------------------------------

function licenseLabel(license, version) {
  if (!license) return 'Licencia libre';
  const name = String(license).toUpperCase();
  return version ? `CC ${name} ${version}` : `CC ${name}`;
}

function normalizeMusic(item) {
  return {
    id: `music:${item.id}`,
    kind: 'music',
    title: String(item.title || 'Sin título').slice(0, 100),
    artist: String(item.creator || 'Desconocido').slice(0, 60),
    audioUrl: item.url || null,
    thumbnailUrl: item.thumbnail || null,
    durationMs: item.duration || null,
    license: licenseLabel(item.license, item.license_version),
    licenseUrl: item.license_url || null,
    sourceUrl: item.foreign_landing_url || item.url || null,
    provider: item.provider || item.source || 'openverse',
  };
}

// Openverse agrega audio con licencia Creative Commons. `license_type=commercial`
// deja fuera lo que no se puede usar en una app con monedas (BY-NC, BY-ND).
async function searchMusic(term, { limit = 20 } = {}) {
  const url = new URL(OPENVERSE_API);
  url.searchParams.set('q', term);
  url.searchParams.set('page_size', String(limit));
  url.searchParams.set('license_type', 'commercial');

  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new HttpError(502, 'El buscador de música no responde');
  const data = await res.json();

  return (data.results || [])
    .map(normalizeMusic)
    .filter((item) => item.audioUrl);
}

async function commonsRequest(params) {
  const url = `${COMMONS_API}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new HttpError(502, 'El buscador de vídeo no responde');
  return res.json();
}

// Wikimedia Commons no busca y devuelve el archivo en una sola llamada: primero
// los títulos y luego la URL real de cada uno (`imageinfo`).
async function searchVideos(term, { limit = 20 } = {}) {
  const found = await commonsRequest({
    action: 'query',
    format: 'json',
    list: 'search',
    srsearch: `filetype:video ${term}`,
    srnamespace: '6',
    srlimit: String(limit),
  });

  const titles = (found.query?.search || []).map((s) => s.title).filter(Boolean);
  if (!titles.length) return [];

  const info = await commonsRequest({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '640',
    titles: titles.join('|'),
  });

  const pages = Object.values(info.query?.pages || {});
  return pages
    .map((page) => {
      const file = page.imageinfo?.[0];
      if (!file?.url) return null;
      const meta = file.extmetadata || {};
      const license = meta.LicenseShortName?.value || 'Licencia libre';
      return {
        id: `video:${page.pageid}`,
        kind: 'video',
        title: String(page.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').slice(0, 100),
        videoUrl: file.url,
        thumbnailUrl: file.thumburl || null,
        durationMs: file.duration ? Math.round(Number(file.duration) * 1000) : null,
        license,
        licenseUrl: meta.LicenseUrl?.value || null,
        sourceUrl: file.descriptionurl || null,
        provider: 'wikimedia',
      };
    })
    .filter(Boolean);
}

// ¿Esta URL salió de una búsqueda reciente? El proxy de previsualización es
// público (una etiqueta `<audio>`/`<img>` no puede mandar cabecera de sesión),
// así que en vez de fiarse del parámetro se comprueba contra lo que el propio
// buscador acaba de ofrecer. Sin esto sería un proxy abierto a cualquier host.
function isKnownMediaUrl(rawUrl) {
  const target = String(rawUrl || '');
  if (!target) return false;
  for (const entry of cache.values()) {
    const { music = [], videos = [] } = entry.value || {};
    for (const item of music) {
      if (item.audioUrl === target || item.thumbnailUrl === target) return true;
    }
    for (const item of videos) {
      if (item.videoUrl === target || item.thumbnailUrl === target) return true;
    }
  }
  return false;
}

async function search(term, { kind = 'all', limit = 20 } = {}) {
  const clean = String(term || '').trim();
  if (!clean) return { music: [], videos: [] };

  const key = `${kind}:${limit}:${clean.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const [music, videos] = await Promise.all([
    kind === 'video' ? Promise.resolve([]) : searchMusic(clean, { limit }),
    kind === 'music' ? Promise.resolve([]) : searchVideos(clean, { limit }),
  ]);

  const result = { music, videos };
  cacheSet(key, result);
  return result;
}

// --- Importación --------------------------------------------------------

// Trae un fichero de fuera y lo deja en el almacenamiento propio. Devuelve la
// URL definitiva y los datos del origen para que la ruta cree el registro.
async function importFromUrl(rawUrl, { kind, prefix = 'discover', maxBytes } = {}) {
  const { filePath, dir, contentType, size } = await downloadToTemp(rawUrl, { maxBytes });
  try {
    if (!size) throw new HttpError(502, 'El archivo llegó vacío');
    const extension = extensionFor(contentType, parseUrl(rawUrl).pathname);
    const url = await storeDownloaded({ filePath, extension, prefix });
    return { url, contentType, size };
  } finally {
    await cleanup(dir);
  }
}

module.exports = {
  search,
  searchMusic,
  searchVideos,
  importFromUrl,
  openStream,
  parseUrl,
  isPrivateIp,
  isKnownMediaUrl,
};
