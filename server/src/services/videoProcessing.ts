import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { p2pService } from './p2p.js';

const execAsync = promisify(exec);

interface ProcessedVideo {
  originalPath: string;
  processedPaths: {
    low: string;
    medium: string;
    high: string;
  };
  thumbnailPath: string;
  duration: number;
  magnetURI?: string;
  ipfsCID?: string;
  metadata: {
    width: number;
    height: number;
    codec: string;
    bitrate: number;
  };
}

interface VideoQuality {
  resolution: string;
  bitrate: string;
  maxWidth: number;
}

const VIDEO_QUALITIES: VideoQuality[] = [
  { resolution: '480p', bitrate: '1000k', maxWidth: 854 },
  { resolution: '720p', bitrate: '2500k', maxWidth: 1280 },
  { resolution: '1080p', bitrate: '5000k', maxWidth: 1920 },
  { resolution: 'av1_low', bitrate: '400k', maxWidth: 480 }, // Ultra-low bandwidth high quality
];

class VideoProcessingService {
  private tempDir: string;
  private outputDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'uploads', 'temp');
    this.outputDir = path.join(process.cwd(), 'uploads', 'videos');
    this.ensureDirectories();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async processVideo(inputPath: string): Promise<ProcessedVideo> {
    const videoId = randomUUID();
    const outputBase = path.join(this.outputDir, videoId);

    const metadata = await this.getVideoMetadata(inputPath);

    const processedPaths: any = {};
    for (const quality of VIDEO_QUALITIES) {
      const outputPath = `${outputBase}_${quality.resolution}.mp4`;
      await this.transcodeVideo(inputPath, outputPath, quality);
      processedPaths[quality.resolution.replace('p', '')] = outputPath;
    }

    const thumbnailPath = `${outputBase}_thumb.jpg`;
    await this.generateThumbnail(inputPath, thumbnailPath);

    // Seed on P2P Network (Hybrid CDN)
    console.log('🚀 Triggering P2P seeding for processed video...');
    const mainVideoPath = processedPaths['1080'] || processedPaths['720'] || processedPaths['480'];
    const p2pData = await p2pService.seedVideo(mainVideoPath);

    return {
      originalPath: inputPath,
      processedPaths,
      thumbnailPath,
      duration: metadata.duration,
      magnetURI: p2pData.magnetURI,
      ipfsCID: p2pData.cid,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        codec: metadata.codec,
        bitrate: metadata.bitrate,
      },
    };
  }

  private async getVideoMetadata(
    inputPath: string
  ): Promise<{ duration: number; width: number; height: number; codec: string; bitrate: number }> {
    const ffprobeCommand = `ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`;
    
    try {
      const { stdout } = await execAsync(ffprobeCommand);
      const probeData = JSON.parse(stdout);
      
      const videoStream = probeData.streams.find(
        (s: any) => s.codec_type === 'video'
      );

      return {
        duration: parseFloat(probeData.format.duration) || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        codec: videoStream?.codec_name || 'unknown',
        bitrate: parseInt(probeData.format.bit_rate) || 0,
      };
    } catch (error) {
      console.error('Error getting video metadata:', error);
      return { duration: 0, width: 0, height: 0, codec: 'unknown', bitrate: 0 };
    }
  }

  private async transcodeVideo(
    inputPath: string,
    outputPath: string,
    quality: VideoQuality
  ): Promise<void> {
    const isAV1 = quality.resolution.includes('av1');
    const vcodec = isAV1 ? 'libsvtav1' : 'libx264'; // Use SVT-AV1 if available
    
    const ffmpegCommand = `ffmpeg -i "${inputPath}" \
      -vcodec ${vcodec} \
      -acodec aac \
      -b:v ${quality.bitrate} \
      -b:a 128k \
      -vf "scale=-2:${quality.maxWidth}" \
      -preset ${isAV1 ? '6' : 'medium'} \
      ${isAV1 ? '' : '-crf 23'} \
      -movflags +faststart \
      -y \
      "${outputPath}"`;

    try {
      await execAsync(ffmpegCommand);
    } catch (error) {
      console.error(`Error transcoding to ${quality.resolution}:`, error);
      throw error;
    }
  }

  private async generateThumbnail(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    const ffmpegCommand = `ffmpeg -i "${inputPath}" \
      -ss 00:00:01 \
      -vframes 1 \
      -vf "scale=320:-1" \
      -q:v 2 \
      -y \
      "${outputPath}"`;

    try {
      await execAsync(ffmpegCommand);
    } catch (error) {
      console.error('Error generating thumbnail:', error);
    }
  }

  async generateGif(
    inputPath: string,
    startTime: number = 0,
    duration: number = 3
  ): Promise<string> {
    const gifId = randomUUID();
    const outputPath = path.join(this.tempDir, `${gifId}.gif`);

    const ffmpegCommand = `ffmpeg -i "${inputPath}" \
      -ss ${startTime} \
      -t ${duration} \
      -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
      -loop 0 \
      -y \
      "${outputPath}"`;

    try {
      await execAsync(ffmpegCommand);
      return outputPath;
    } catch (error) {
      console.error('Error generating GIF:', error);
      throw error;
    }
  }

  async addWatermark(
    inputPath: string,
    watermarkText: string = 'TakTak'
  ): Promise<string> {
    const watermarkedId = randomUUID();
    const outputPath = path.join(this.outputDir, `${watermarkedId}_watermarked.mp4`);

    const ffmpegCommand = `ffmpeg -i "${inputPath}" \
      -vf "drawtext=text='${watermarkText}':fontcolor=white@0.5:fontsize=24:x=10:y=10" \
      -c:a copy \
      -y \
      "${outputPath}"`;

    try {
      await execAsync(ffmpegCommand);
      return outputPath;
    } catch (error) {
      console.error('Error adding watermark:', error);
      throw error;
    }
  }

  cleanupTempFiles(filePaths: string[]) {
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Error cleaning up file ${filePath}:`, error);
      }
    }
  }
}

export const videoProcessingService = new VideoProcessingService();
