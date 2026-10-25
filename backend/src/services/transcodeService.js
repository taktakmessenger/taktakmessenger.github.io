const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const env = require('../config/env');

// A system ffmpeg is an optional dependency. We resolve the binary once and
// cache the answer, so a deployment without ffmpeg can still accept uploads
// (the original file is served as-is) instead of failing every request.
let ffmpegAvailable = null;

// `fs.access('ffmpeg')` would resolve relative to the process cwd and fail for
// the default bare command name, silently disabling HLS everywhere. A bare
// name has to be looked up on PATH by actually invoking it.
function canRun(binary) {
  return new Promise((resolve) => {
    if (path.isAbsolute(binary)) {
      fs.access(binary).then(() => resolve(true)).catch(() => resolve(false));
      return;
    }
    execFile(binary, ['-version'], { timeout: 5000 }, (err) => resolve(!err));
  });
}

async function hasFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  if (!env.transcodeEnabled) {
    ffmpegAvailable = false;
    return false;
  }

  ffmpegAvailable = await canRun(env.ffmpegPath);

  if (!ffmpegAvailable) {
    console.warn(
      '[transcode] ffmpeg no disponible o TRANSCODE_ENABLED!=true: los videos se servirán sin HLS'
    );
  }
  return ffmpegAvailable;
}

// Kept in one place so the size of the generated renditions cannot drift
// between the playlist and the segment filenames.
const RENDITIONS = [{ name: '480p', width: 480, height: 854, bitrate: '800k' }];

const THUMBNAIL_SIZE = { width: 480, height: 854 };

// Scales to fit inside the target box and pads the remainder. A plain
// `-s WxH` would stretch a landscape clip into the vertical frame and
// distort it; fitting and padding keeps the picture correct, letterboxed.
function scalePadFilter(width, height) {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
  );
}

// --- Marca de TAK TAK -------------------------------------------------------
//
// Un vídeo bajado de otra red llega con su marca y sus metadatos. La marca
// pegada en los píxeles no se puede quitar sin recodificar a peor calidad, pero
// sí se hacen las dos cosas que se pidieron: se borra todo rastro en los
// metadatos (nombre, autor, etiquetas, herramienta) y se deja encima la marca
// de TAK TAK con el @usuario, como hace la otra red pero con la identidad de
// aquí.
const BRAND_FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
];

let brandFont = null;

async function resolveBrandFont() {
  if (brandFont !== null) return brandFont;
  for (const candidate of BRAND_FONT_CANDIDATES) {
    try {
      await fs.access(candidate);
      brandFont = candidate;
      return brandFont;
    } catch {
      // Se prueba el siguiente candidato.
    }
  }
  console.warn('[transcode] sin fuente para la marca: los vídeos se limpiarán pero sin marca');
  brandFont = false;
  return brandFont;
}

// El texto de la marca va en un fichero porque `textfile` evita escapar el
// @usuario: dentro de una cadena de filtros, `:`, `%` o una coma lo romperían.
// Se limpian esos caracteres del nombre para que no puedan romper el filtro.
function brandText(username) {
  const handle = String(username || '').replace(/[\s:%,'\\]/g, '').slice(0, 40);
  const lines = [handle ? `@${handle}` : null, 'TAK TAK'].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

async function writeBrandText(targetDir, username) {
  const file = path.join(targetDir, 'brand.txt');
  await fs.writeFile(file, brandText(username));
  return file;
}

// Caja semitransparente con el @usuario y "TAK TAK" centrada abajo. El tamaño
// se deriva de la altura para que se lea igual en cualquier resolución.
function watermarkFilter(fontFile, textFile, height) {
  const size = Math.max(20, Math.round(height / 20));
  const margin = Math.round(size * 1.2);
  return (
    `drawtext=fontfile=${fontFile}:textfile=${textFile}:` +
    `fontcolor=white:fontsize=${size}:line_spacing=${Math.round(size / 3)}:` +
    `box=1:boxcolor=black@0.45:boxborderw=${Math.round(size / 2)}:` +
    `x=(w-text_w)/2:y=h-th-${margin}`
  );
}

// Opciones que borran todo rastro en los metadatos. `bitexact` evita además que
// el muxer escriba su propia firma, así que no queda ni el nombre del archivo
// original ni la herramienta con la que se procesó.
const CLEAN_METADATA_OPTIONS = [
  '-map_metadata',
  '-1',
  '-fflags',
  '+bitexact',
  '-flags:v',
  '+bitexact',
  '-flags:a',
  '+bitexact',
];

// Reescribe el contenedor sin tocar los códecs (`-c copy`) para dejar el
// archivo sin metadatos. Al no recodificar, la calidad es idéntica y es rápido.
//
// Se escribe en un temporal y se renombra: si ffmpeg falla a medias, el archivo
// bueno sigue en su sitio en lugar de quedar truncado. Un fallo aquí no debe
// tumbar el resto del proceso, así que se traga el error y se avisa.
function cleanMetadata(inputPath) {
  const tempPath = `${inputPath}.clean${path.extname(inputPath) || '.mp4'}`;
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .setFfmpegPath(env.ffmpegPath)
      .outputOptions(['-c', 'copy', ...CLEAN_METADATA_OPTIONS])
      .output(tempPath)
      .on('end', async () => {
        try {
          await fs.rename(tempPath, inputPath);
        } catch (err) {
          console.warn('[transcode] no se pudo reemplazar el original limpio:', err.message);
          await fs.rm(tempPath, { force: true }).catch(() => {});
        }
        resolve();
      })
      .on('error', async (err) => {
        console.warn('[transcode] no se pudieron limpiar los metadatos:', err.message);
        await fs.rm(tempPath, { force: true }).catch(() => {});
        resolve();
      })
      .run();
  });
}

function variantDir(baseDir, name) {
  return path.join(baseDir, name);
}

/**
 * Transcode an uploaded file into a multi-bitrate HLS ladder and grab a
 * thumbnail. Returns null when ffmpeg is unavailable so callers can fall back
 * to the original upload.
 *
 * `username` es el @usuario que se imprime en la marca de TAK TAK. Sin él, el
 * vídeo se limpia igual pero la marca solo dice "TAK TAK".
 */
async function processVideoToHLS(inputPath, outputDir, videoId, username) {
  if (!(await hasFfmpeg())) return null;

  // El archivo original es el que se sirve tal cual mientras no hay HLS, y es
  // el que se descarga: si llegó con el título, el autor o el enlace de otra
  // red, hay que limpiarlo ahí también. Se hace antes de nada para que ni el
  // probe de duración ni el HLS vean el nombre viejo.
  await cleanMetadata(inputPath);

  const targetDir = path.join(outputDir, videoId);
  await fs.mkdir(targetDir, { recursive: true });

  const fontFile = await resolveBrandFont();
  const brandFile = fontFile ? await writeBrandText(targetDir, username) : null;

  // Generate the poster frame first: it is cheap and useful even if the
  // transcode below fails partway.
  await generateThumbnail(inputPath, targetDir, fontFile, brandFile);

  await Promise.all(
    RENDITIONS.map((rendition) =>
      transcodeVariant(inputPath, variantDir(targetDir, rendition.name), rendition, fontFile, brandFile)
    )
  );

  await writeMasterPlaylist(targetDir);

  return {
    playlistUrl: `/uploads/${videoId}/index.m3u8`,
    thumbnailUrl: `/uploads/${videoId}/thumbnail.jpg`,
    renditions: RENDITIONS.map((r) => r.name),
  };
}

function grabFrame(inputPath, targetDir, seconds, fontFile, brandFile) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath).setFfmpegPath(env.ffmpegPath);
    if (seconds > 0) command.seekInput(seconds);

    // La miniatura también lleva la marca: es la carátula del vídeo en el feed,
    // y ahí es donde se ve si el vídeo es de aquí.
    const filters = [scalePadFilter(THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height)];
    if (fontFile && brandFile) {
      filters.push(watermarkFilter(fontFile, brandFile, THUMBNAIL_SIZE.height));
    }

    command
      .outputOptions([
        '-frames:v 1',
        // Same fit-and-pad filter as the renditions: a bare `-s` would stretch
        // a landscape frame into the vertical box.
        `-vf ${filters.join(',')}`,
        '-q:v 3',
        ...CLEAN_METADATA_OPTIONS,
      ])
      .output(path.join(targetDir, 'thumbnail.jpg'))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function generateThumbnail(inputPath, targetDir, fontFile, brandFile) {
  // A clip shorter than one second has no frame at 1s, so fall back to the
  // first one rather than leaving the video without a poster.
  return grabFrame(inputPath, targetDir, 1, fontFile, brandFile).catch(() =>
    grabFrame(inputPath, targetDir, 0, fontFile, brandFile)
  );
}

function transcodeVariant(inputPath, outDir, rendition, fontFile, brandFile) {
  const filters = [scalePadFilter(rendition.width, rendition.height)];
  if (fontFile && brandFile) {
    filters.push(watermarkFilter(fontFile, brandFile, rendition.height));
  }

  return fs.mkdir(outDir, { recursive: true }).then(
    () =>
      new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setFfmpegPath(env.ffmpegPath)
          .outputOptions([
            '-preset fast',
            // A fixed GOP with scene-cut detection off keeps every segment
            // independently seekable, which is what makes scrubbing work.
            '-g 48',
            '-sc_threshold 0',
            '-map 0:v:0',
            '-map 0:a:0?',
            // Sin subtítulos ni pistas de datos: algunos contenedores de móvil
            // traen pistas que rompen el muxing a MPEG-TS del HLS.
            '-sn',
            '-dn',
            `-vf ${filters.join(',')}`,
            '-c:v:0 libx264',
            `-b:v:0 ${rendition.bitrate}`,
            // Nivel y perfil compatibles con móviles antiguos y con el
            // decodificador por hardware de la mayoría de navegadores.
            '-profile:v high',
            '-pix_fmt yuv420p',
            '-c:a aac',
            '-b:a 128k',
            '-ac 2',
            ...CLEAN_METADATA_OPTIONS,
            '-f hls',
            '-hls_time 4',
            '-hls_playlist_type vod',
            `-hls_segment_filename ${path.join(outDir, 'segment_%03d.ts')}`,
          ])
          .output(path.join(outDir, 'index.m3u8'))
          .on('end', resolve)
          .on('error', reject)
          .run();
      })
  );
}

async function writeMasterPlaylist(targetDir) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const rendition of RENDITIONS) {
    const bandwidth = Number.parseInt(rendition.bitrate, 10) * 1000;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${rendition.width}x${rendition.height}`,
      `${rendition.name}/index.m3u8`
    );
  }
  await fs.writeFile(path.join(targetDir, 'index.m3u8'), `${lines.join('\n')}\n`);
}

// Probe duration so the retention maths in analytics has a denominator.
function probeDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err || !metadata?.format?.duration) return resolve(null);
      resolve(Number(metadata.format.duration));
    });
  });
}

module.exports = {
  processVideoToHLS,
  probeDuration,
  hasFfmpeg,
  RENDITIONS,
  brandText,
  watermarkFilter,
  CLEAN_METADATA_OPTIONS,
};
