// Conversión de vídeo a HLS, en segundo plano y de uno en uno.
//
// Vive aquí y no en la ruta de subida porque la usan tres sitios (subir,
// reprocesar un vídeo y reprocesar los que faltan) y porque necesita estado
// propio: la cola. La ruta solo encola.
const path = require('path');
const Video = require('../models/Video');
const env = require('../config/env');
const transcodeService = require('./transcodeService');
const storageService = require('./storageService');
const { createSerialQueue } = require('../lib/transcodeQueue');

// El plan gratuito de Render tiene 512 MB y el contenedor se reinicia al
// pasarse (`oomKilled`); con dos ffmpeg a la vez el proceso muere a mitad y el
// vídeo se queda sin HLS (pantalla negra). La cola garantiza que solo corre uno.
const queue = createSerialQueue((job) => run(job.video, job.inputPath, job.username));

function enqueue(video, inputPath, username) {
  queue.enqueue({ video, inputPath, username });
}

// Convierte el vídeo y deja el resultado en la base. No lanza: los fallos se
// guardan en el propio vídeo para que el creador los vea.
async function run(video, inputPath, username) {
  // The client-declared duration is a hint; measuring the file is the only way
  // to be sure, and analytics divides by it.
  transcodeService
    .probeDuration(inputPath)
    .then((duration) => {
      if (duration) {
        return Video.updateOne({ _id: video._id }, { duration });
      }
      return null;
    })
    .catch(() => {});

  // El original se publica en el bucket antes de transcodificar: es lo que
  // convierte `videoUrl` en una URL permanente. Va aquí, en segundo plano, y no
  // en la respuesta de la subida, porque subir un fichero de cientos de megas
  // tardaría más que el tiempo de espera del proxy y la petición se cortaría.
  // Mientras tanto el vídeo ya se ve por la ruta local.
  const originalKey = path.basename(inputPath);
  if (storageService.isConfigured()) {
    storageService
      .putFile(inputPath, originalKey)
      .then((url) => Video.updateOne({ _id: video._id }, { videoUrl: url }))
      .catch((err) => console.error('[storage] no se pudo publicar el original:', err.message));
  }

  try {
    const musicUrl = await transcodeService.resolveMusicUrl(video);
    const result = await transcodeService.processVideoToHLS(
      inputPath,
      env.uploadsDir,
      video._id.toString(),
      username,
      musicUrl
    );

    if (!result) {
      // `null` significa "no hay ffmpeg o está apagado", no "algo se rompió".
      // Antes se guardaba `failed`, y la app mostraba "⚠️ No se pudo optimizar"
      // en cada vídeo aunque el original se reprodujera perfectamente: el
      // creador creía que la subida había fallado. `none` es la verdad.
      await Video.updateOne({ _id: video._id }, { transcodeStatus: 'none' });
      return;
    }

    let { playlistUrl, thumbnailUrl } = result;

    // La escalera HLS también vive en el bucket: si se quedara en el disco
    // efímero, el vídeo se vería bien hoy y daría 404 tras el próximo
    // despliegue, que es justo el fallo que esto evita.
    if (storageService.isConfigured()) {
      const renditionsDir = path.join(env.uploadsDir, video._id.toString());
      await storageService.putDirectory(renditionsDir, video._id.toString());
      playlistUrl = storageService.publicUrl(`${video._id}/index.m3u8`);
      thumbnailUrl = storageService.publicUrl(`${video._id}/thumbnail.jpg`);
    }

    await Video.updateOne(
      { _id: video._id },
      {
        hlsUrl: playlistUrl,
        thumbnailUrl,
        transcodeStatus: 'ready',
        transcodeError: null,
      }
    );
  } catch (err) {
    console.error('[transcode] fallo:', err.message);
    await Video.updateOne(
      { _id: video._id },
      { transcodeStatus: 'failed', transcodeError: err.message }
    ).catch(() => {});
  }
}

// Un `processing` no puede sobrevivir a un reinicio: la conversión vive en la
// memoria del proceso, así que si el contenedor se reinició (por ejemplo, por
// `oomKilled` a mitad de un transcode) ese vídeo se queda marcado para siempre y
// el endpoint de reproceso lo salta por estar "en curso". Al arrancar se
// desatasca a `failed`, que sí es reintentable, para que vuelva a convertirse.
async function recoverStuck() {
  const result = await Video.updateMany(
    { transcodeStatus: 'processing' },
    {
      transcodeStatus: 'failed',
      transcodeError: 'La conversión se interrumpió al reiniciarse el servidor',
    }
  );
  const recovered = result.modifiedCount ?? result.nModified ?? 0;
  if (recovered > 0) {
    console.log(`[transcode] ${recovered} vídeo(s) atascado(s) marcados para reintento`);
  }
  return recovered;
}

module.exports = { enqueue, run, recoverStuck };
