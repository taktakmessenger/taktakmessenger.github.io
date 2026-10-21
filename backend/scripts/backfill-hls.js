// Retroconvierte a HLS los vídeos subidos antes de que hubiera ffmpeg (o cuyo
// transcode falló). Sin esto, un .mp4 H.265/HEVC de iPhone se queda servido tal
// cual y el navegador ni lo muestra ni lo reproduce: error de formato.
//
// Uso:
//   cd backend && node scripts/backfill-hls.js          # solo lo que falta
//   cd backend && node scripts/backfill-hls.js --all    # rehace todos
require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const mongoose = require('mongoose');
const Video = require('../src/models/Video');
const env = require('../src/config/env');
const transcodeService = require('../src/services/transcodeService');

async function main() {
  if (!(await transcodeService.hasFfmpeg())) {
    console.error('ffmpeg no está disponible: instálalo o define FFMPEG_PATH.');
    process.exit(1);
  }

  await mongoose.connect(env.mongoUri);
  const onlyMissing = !process.argv.includes('--all');
  const filter = onlyMissing ? { hlsUrl: { $exists: false } } : {};
  const videos = await Video.find(filter).select('_id videoUrl title');

  console.log(`Vídeos a procesar: ${videos.length}${onlyMissing ? ' (sin HLS)' : ' (todos)'}`);

  let ok = 0;
  let failed = 0;
  for (const video of videos) {
    const inputPath = path.join(env.uploadsDir, path.basename(video.videoUrl));
    try {
      await fs.access(inputPath);
    } catch {
      console.warn(`- ${video._id} ${video.title}: falta el original, se omite`);
      failed += 1;
      continue;
    }

    process.stdout.write(`- ${video._id} ${video.title}… `);
    try {
      const duration = await transcodeService.probeDuration(inputPath);
      const result = await transcodeService.processVideoToHLS(
        inputPath,
        env.uploadsDir,
        video._id.toString()
      );
      if (!result) throw new Error('sin resultado de transcodificación');

      await Video.updateOne(
        { _id: video._id },
        {
          hlsUrl: result.playlistUrl,
          thumbnailUrl: result.thumbnailUrl,
          transcodeStatus: 'ready',
          transcodeError: null,
          ...(duration ? { duration } : {}),
        }
      );
      ok += 1;
      console.log('ok');
    } catch (err) {
      failed += 1;
      console.log(`fallo: ${err.message}`);
      await Video.updateOne(
        { _id: video._id },
        { transcodeStatus: 'failed', transcodeError: err.message }
      ).catch(() => {});
    }
  }

  console.log(`\nListo: ${ok} convertidos, ${failed} con problemas.`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fallo general:', err.message);
  process.exit(1);
});
