import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execAsync = promisify(exec);

/**
 * Audio Extractor
 *
 * Transcribes audio files using Transformers.js (local Whisper model).
 * Supports common audio formats: MP3, WAV, M4A, FLAC, OGG, AAC, WMA.
 *
 * Uses Whisper-base model (~150MB) for good balance of speed and accuracy.
 * Runs completely locally - no API calls, no API keys needed.
 */

export interface AudioMetadata {
  duration: number; // seconds
  format: string;
  size: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
}

export interface TranscriptionSegment {
  id: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface TranscribeAudioResult {
  success: boolean;
  transcript?: string;
  segments?: TranscriptionSegment[];
  metadata?: AudioMetadata;
  language?: string;
  error?: string;
}

export interface AudioExtractionOptions {
  language?: string; // ISO-639-1 language code (e.g., 'en', 'es', 'fr')
  returnTimestamps?: boolean; // Return timestamps for segments (default: false)
  chunkLength?: number; // Chunk length in seconds (default: 30)
}

export interface EmotionAnalysis {
  primary: string; // Primary emotion (highest confidence)
  confidence: number; // Confidence score 0-1
  all: Record<string, number>; // All emotion scores
}

export interface AnalyzeEmotionResult {
  success: boolean;
  emotion?: EmotionAnalysis;
  audioDuration?: number; // seconds
  error?: string;
}

export class AudioExtractor {
  private static transcriber: any = null;
  private static initPromise: Promise<any> | null = null;

  constructor() {
    // Pipeline initialization happens lazily on first use
  }

  /**
   * Initialize Whisper pipeline (lazy loading)
   * Can be called publicly to pre-load model during app startup
   */
  async initializeTranscriber(): Promise<any> {
    // If already initialized, return cached instance
    if (AudioExtractor.transcriber) {
      return AudioExtractor.transcriber;
    }

    // If initialization in progress, wait for it
    if (AudioExtractor.initPromise) {
      return AudioExtractor.initPromise;
    }

    // Start initialization
    AudioExtractor.initPromise = (async () => {
      try {
        console.log('[AudioExtractor] Loading Whisper model from cache...');

        // Lazy import @xenova/transformers to avoid loading ONNX runtime at module load time
        // This is critical - importing the module loads ONNX even if pipeline() isn't called yet
        const { pipeline } = await import('@xenova/transformers');

        // Create pipeline for automatic speech recognition
        // Using whisper-base for good balance of speed and accuracy
        // Note: ONNX warnings are suppressed globally in CLI startup
        const transcriber = await pipeline(
          'automatic-speech-recognition',
          'Xenova/whisper-base',
          {
            // Cache model locally to avoid re-downloading
            cache_dir: path.join(process.cwd(), '.cache', 'whisper')
          }
        );

        console.log('[AudioExtractor] Whisper model loaded successfully');
        AudioExtractor.transcriber = transcriber;
        return transcriber;
      } catch (error: any) {
        console.error('[AudioExtractor] Failed to initialize Whisper model:');
        console.error('Error type:', typeof error);
        console.error('Error message:', error?.message);
        console.error('Error stack:', error?.stack);
        console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
        throw error;
      }
    })();

    return AudioExtractor.initPromise;
  }

  /**
   * Check if extractor is configured (always true for local models)
   */
  isConfigured(): boolean {
    return true; // Local model, no API key needed
  }

  /**
   * Check if ffprobe is available (for metadata extraction)
   */
  async checkFFprobe(): Promise<boolean> {
    try {
      await execAsync('ffprobe -version');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract metadata from audio file using ffprobe
   */
  async extractMetadata(filePath: string): Promise<AudioMetadata | null> {
    try {
      const hasFFprobe = await this.checkFFprobe();
      if (!hasFFprobe) {
        console.warn('[AudioExtractor] ffprobe not available - metadata extraction disabled');
        const stats = fs.statSync(filePath);
        const extension = path.extname(filePath).toLowerCase();
        return {
          duration: 0,
          format: extension.substring(1),
          size: stats.size,
        };
      }

      const stats = fs.statSync(filePath);
      const extension = path.extname(filePath).toLowerCase();

      // Use ffprobe to get audio metadata
      const { stdout } = await execAsync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
      );

      const metadata = JSON.parse(stdout);
      const audioStream = metadata.streams?.find((s: any) => s.codec_type === 'audio');
      const format = metadata.format;

      return {
        duration: parseFloat(format.duration || '0'),
        format: extension.substring(1),
        size: stats.size,
        bitrate: audioStream?.bit_rate ? parseInt(audioStream.bit_rate) : undefined,
        sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : undefined,
        channels: audioStream?.channels || undefined,
      };
    } catch (error) {
      console.error('[AudioExtractor] Error extracting metadata:', error);
      return null;
    }
  }

  /**
   * Transcribe audio file using local Whisper model (Transformers.js)
   */
  async transcribeAudio(
    filePath: string,
    options: AudioExtractionOptions = {}
  ): Promise<TranscribeAudioResult> {
    try {
      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      // Extract metadata (optional, non-blocking)
      const metadata = await this.extractMetadata(filePath);

      console.log(`[AudioExtractor] Transcribing audio: ${path.basename(filePath)}`);
      console.log(`[AudioExtractor] This may take a few minutes for long audio files...`);

      // Initialize transcriber
      const transcriber = await this.initializeTranscriber();
      console.log(`[AudioExtractor] Transcriber initialized, type: ${typeof transcriber}`);

      // Load audio file using ffmpeg (Transformers.js can't load file paths in Node.js)
      console.log(`[AudioExtractor] Loading audio file with ffmpeg...`);

      // Use ffmpeg to convert audio to 16kHz mono WAV (required by Whisper)
      const { stdout } = await execAsync(
        `ffmpeg -i "${filePath}" -ar 16000 -ac 1 -f f32le -`,
        { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 } // 100MB buffer for large audio files
      );

      // Convert buffer to Float32Array (raw audio samples)
      const audioData = new Float32Array(
        stdout.buffer,
        stdout.byteOffset,
        stdout.byteLength / Float32Array.BYTES_PER_ELEMENT
      );

      console.log(`[AudioExtractor] Audio loaded: ${audioData.length} samples (${(audioData.length / 16000).toFixed(2)}s)`);

      // Transcribe audio file
      console.log(`[AudioExtractor] Starting transcription with options:`, {
        language: options.language || null,
        return_timestamps: options.returnTimestamps !== false,
        chunk_length_s: options.chunkLength || 30
      });

      // Note: ONNX warnings are suppressed globally in CLI startup
      const result = await transcriber(audioData, {
        language: options.language || null, // Auto-detect if not specified
        return_timestamps: options.returnTimestamps !== false, // Default to true
        chunk_length_s: options.chunkLength || 30, // Process in 30-second chunks
      });

      console.log(`[AudioExtractor] Transcription complete`);
      console.log(`[AudioExtractor] Result type: ${typeof result}, has text: ${!!result?.text}`);

      // Parse result
      let transcript = '';
      let segments: TranscriptionSegment[] = [];

      if (result.text) {
        transcript = result.text;
      }

      // Extract segments if timestamps were returned
      if (result.chunks && Array.isArray(result.chunks)) {
        segments = result.chunks.map((chunk: any, idx: number) => ({
          id: idx,
          start: chunk.timestamp?.[0] || 0,
          end: chunk.timestamp?.[1] || 0,
          text: chunk.text.trim(),
        }));
      }

      // Detect language (Whisper can auto-detect)
      // For now, we'll use the specified language or default to 'en'
      const language = options.language || 'en';

      return {
        success: true,
        transcript: transcript,
        segments: segments.length > 0 ? segments : undefined,
        metadata: metadata || undefined,
        language: language,
      };
    } catch (error: any) {
      // Comprehensive error logging
      console.error('[AudioExtractor] Transcription error details:');
      console.error('Error type:', typeof error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Error name:', error?.name);
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

      return {
        success: false,
        error: error?.message || error?.toString() || 'Unknown error during transcription',
      };
    }
  }

  /**
   * Analyze emotions from audio file using Python subprocess
   * Uses wav2vec2-lg-xlsr-en-speech-emotion-recognition model
   * Detects 8 emotions: angry, calm, disgust, fearful, happy, neutral, sad, surprised
   */
  async analyzeEmotions(filePath: string): Promise<AnalyzeEmotionResult> {
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      console.log(`[AudioExtractor] Analyzing emotions from: ${path.basename(filePath)}`);
      console.log(`[AudioExtractor] Using wav2vec2 emotion recognition model (Python subprocess)...`);

      // Path to Python script (ES modules compatible)
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const scriptPath = path.join(__dirname, 'audio-emotion-analyzer.py');

      // Check if Python script exists
      if (!fs.existsSync(scriptPath)) {
        return {
          success: false,
          error: `Python script not found: ${scriptPath}. Please ensure audio-emotion-analyzer.py is present.`,
        };
      }

      // Execute Python script using venv Python if available, fallback to system python3
      const venvPython = path.join(process.cwd(), 'venv', 'bin', 'python3');
      const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

      const { stdout, stderr } = await execAsync(
        `"${pythonCmd}" "${scriptPath}" "${filePath}"`,
        {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        }
      );

      // Log stderr (contains debug info from Python)
      if (stderr) {
        console.log(`[AudioExtractor] Python stderr:\n${stderr}`);
      }

      // Parse JSON output from Python script
      const result = JSON.parse(stdout.trim());

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Emotion analysis failed',
        };
      }

      console.log(`[AudioExtractor] Emotion analysis complete`);
      console.log(`[AudioExtractor] Primary emotion: ${result.emotion.primary} (${(result.emotion.confidence * 100).toFixed(1)}%)`);

      return {
        success: true,
        emotion: result.emotion,
        audioDuration: result.audio_duration,
      };
    } catch (error: any) {
      console.error('[AudioExtractor] Emotion analysis error:', error);
      return {
        success: false,
        error: error?.message || error?.toString() || 'Unknown error during emotion analysis',
      };
    }
  }

  /**
   * Format transcription for display
   */
  formatTranscript(result: TranscribeAudioResult, includeTimestamps: boolean = false): string {
    if (!result.success || !result.transcript) {
      return result.error || 'Transcription failed';
    }

    let output = '';

    // Add metadata header if available
    if (result.metadata) {
      const duration = (result.metadata.duration / 60).toFixed(1);
      output += `Duration: ${duration} minutes\n`;
      if (result.metadata.bitrate) {
        output += `Bitrate: ${(result.metadata.bitrate / 1000).toFixed(0)} kbps\n`;
      }
      if (result.language) {
        output += `Language: ${result.language}\n`;
      }
      output += '\n';
    }

    // Add transcript
    if (includeTimestamps && result.segments && result.segments.length > 0) {
      output += 'Transcript (with timestamps):\n\n';
      for (const segment of result.segments) {
        const startTime = this.formatTimestamp(segment.start);
        const endTime = this.formatTimestamp(segment.end);
        output += `[${startTime} -> ${endTime}] ${segment.text}\n`;
      }
    } else {
      output += 'Transcript:\n\n';
      output += result.transcript;
    }

    return output;
  }

  /**
   * Format seconds to MM:SS timestamp
   */
  private formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
