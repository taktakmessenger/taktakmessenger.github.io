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

function variantDir(baseDir, name) {
  return path.join(baseDir, name);
}

/**
 * Transcode an uploaded file into a multi-bitrate HLS ladder and grab a
 * thumbnail. Returns null when ffmpeg is unavailable so callers can fall back
 * to the original upload.
 */
async function processVideoToHLS(inputPath, outputDir, videoId) {
  if (!(await hasFfmpeg())) return null;

  const targetDir = path.join(outputDir, videoId);
  await fs.mkdir(targetDir, { recursive: true });

  // Generate the poster frame first: it is cheap and useful even if the
  // transcode below fails partway.
  await generateThumbnail(inputPath, targetDir);

  await Promise.all(
    RENDITIONS.map((rendition) =>
      transcodeVariant(inputPath, variantDir(targetDir, rendition.name), rendition)
    )
  );

  await writeMasterPlaylist(targetDir);

  return {
    playlistUrl: `/uploads/${videoId}/index.m3u8`,
    thumbnailUrl: `/uploads/${videoId}/thumbnail.jpg`,
    renditions: RENDITIONS.map((r) => r.name),
  };
}

function grabFrame(inputPath, targetDir, seconds) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath).setFfmpegPath(env.ffmpegPath);
    if (seconds > 0) command.seekInput(seconds);

    command
      .outputOptions([
        '-frames:v 1',
        // Same fit-and-pad filter as the renditions: a bare `-s` would stretch
        // a landscape frame into the vertical box.
        `-vf ${scalePadFilter(THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height)}`,
        '-q:v 3',
      ])
      .output(path.join(targetDir, 'thumbnail.jpg'))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function generateThumbnail(inputPath, targetDir) {
  // A clip shorter than one second has no frame at 1s, so fall back to the
  // first one rather than leaving the video without a poster.
  return grabFrame(inputPath, targetDir, 1).catch(() =>
    grabFrame(inputPath, targetDir, 0)
  );
}

function transcodeVariant(inputPath, outDir, rendition) {
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
            `-vf ${scalePadFilter(rendition.width, rendition.height)}`,
            '-c:v:0 libx264',
            `-b:v:0 ${rendition.bitrate}`,
            '-c:a aac',
            '-b:a 128k',
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

module.exports = { processVideoToHLS, probeDuration, hasFfmpeg, RENDITIONS };
