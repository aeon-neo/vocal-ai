import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ImageExtractor } from './image-extractor';

const execAsync = promisify(exec);

/**
 * Video Extractor
 *
 * Extracts frames from video files using ffmpeg.
 * Supports common video formats: MP4, MOV, AVI, MKV, WebM.
 */

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  format: string;
  size: number;
}

export interface ExtractedFrame {
  frameNumber: number;
  timestamp: number; // seconds
  base64: string;
  mediaType: string;
}

export interface ExtractVideoResult {
  success: boolean;
  frames?: ExtractedFrame[];
  metadata?: VideoMetadata;
  error?: string;
}

export class VideoExtractor {
  private imageExtractor: ImageExtractor;

  constructor() {
    this.imageExtractor = new ImageExtractor();
  }

  /**
   * Check if ffmpeg is available
   */
  async checkFFmpeg(): Promise<boolean> {
    try {
      await execAsync('ffmpeg -version');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract video metadata using ffprobe
   */
  async extractMetadata(filePath: string): Promise<VideoMetadata | null> {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
      );

      const data = JSON.parse(stdout);
      const videoStream = data.streams.find((s: any) => s.codec_type === 'video');

      if (!videoStream) {
        return null;
      }

      const stats = fs.statSync(filePath);

      return {
        duration: parseFloat(data.format.duration) || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: eval(videoStream.r_frame_rate) || 0, // e.g., "30/1" -> 30
        format: path.extname(filePath).substring(1),
        size: stats.size
      };

    } catch (error) {
      console.error('[VideoExtractor] Error extracting metadata:', error);
      return null;
    }
  }

  /**
   * Extract frames from video at regular intervals
   *
   * @param filePath - Path to video file
   * @param options - Extraction options
   * @param options.maxFrames - Maximum number of frames to extract (default: 10)
   * @param options.interval - Interval in seconds between frames (overrides maxFrames)
   * @param options.startTime - Start time in seconds (default: 0)
   * @param options.endTime - End time in seconds (default: video duration)
   */
  async extractFrames(
    filePath: string,
    options: {
      maxFrames?: number;
      interval?: number;
      startTime?: number;
      endTime?: number;
    } = {}
  ): Promise<ExtractVideoResult> {
    try {
      // Check if ffmpeg is available
      const ffmpegAvailable = await this.checkFFmpeg();
      if (!ffmpegAvailable) {
        return {
          success: false,
          error: 'ffmpeg is not installed or not available in PATH. Please install ffmpeg to process videos.'
        };
      }

      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `Video file not found: ${filePath}`
        };
      }

      // Extract metadata
      const metadata = await this.extractMetadata(filePath);
      if (!metadata) {
        return {
          success: false,
          error: 'Failed to extract video metadata'
        };
      }

      // Calculate frame extraction parameters
      const maxFrames = options.maxFrames || 10;
      const startTime = options.startTime || 0;
      const endTime = options.endTime || metadata.duration;
      const duration = endTime - startTime;

      // Calculate interval between frames
      let interval: number;
      if (options.interval !== undefined) {
        interval = options.interval;
      } else {
        interval = duration / (maxFrames + 1);
      }

      // Create temporary directory for frames
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niimi-video-'));

      try {
        // Extract frames using ffmpeg
        const frames: ExtractedFrame[] = [];
        let frameCount = 0;

        for (let time = startTime + interval; time < endTime && frameCount < maxFrames; time += interval) {
          const outputPath = path.join(tempDir, `frame_${frameCount}.jpg`);

          // Extract single frame at specific timestamp
          await execAsync(
            `ffmpeg -ss ${time} -i "${filePath}" -vframes 1 -q:v 2 "${outputPath}"`
          );

          // Convert frame to base64
          const imageResult = await this.imageExtractor.extractImage(outputPath);
          if (imageResult.success && imageResult.image) {
            frames.push({
              frameNumber: frameCount,
              timestamp: time,
              base64: imageResult.image.base64,
              mediaType: imageResult.image.mediaType
            });
          }

          frameCount++;
        }

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });

        return {
          success: true,
          frames,
          metadata
        };

      } catch (error) {
        // Clean up temp directory on error
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw error;
      }

    } catch (error) {
      return {
        success: false,
        error: `Failed to extract frames: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Extract audio from video (for transcription)
   */
  async extractAudio(filePath: string, outputPath?: string): Promise<string | null> {
    try {
      const ffmpegAvailable = await this.checkFFmpeg();
      if (!ffmpegAvailable) {
        console.error('[VideoExtractor] ffmpeg not available');
        return null;
      }

      const output = outputPath || path.join(
        os.tmpdir(),
        `audio_${Date.now()}.mp3`
      );

      await execAsync(
        `ffmpeg -i "${filePath}" -vn -acodec libmp3lame -q:a 2 "${output}"`
      );

      return output;

    } catch (error) {
      console.error('[VideoExtractor] Error extracting audio:', error);
      return null;
    }
  }

  /**
   * Format frames for Claude API message content
   */
  formatFramesForClaude(frames: ExtractedFrame[]): any[] {
    return frames.map(frame => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: frame.mediaType,
        data: frame.base64
      }
    }));
  }
}
