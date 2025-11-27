import * as fs from 'fs';
import * as path from 'path';

/**
 * File Validation Utility
 *
 * Validates files before ingestion to ensure they can be processed.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  filePath?: string;
  size?: number;
  extension?: string;
}

/**
 * File Validator
 *
 * Validates documents before ingestion.
 * Supports multiple formats: PDF, Word (.docx, .doc)
 */
export class FileValidator {
  private static readonly MAX_FILE_SIZE_MB = parseInt(
    process.env.MAX_DOCUMENT_SIZE_MB || '50',
    10
  );

  // Supported document extensions
  private static readonly SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.md', '.markdown'];

  // Supported image extensions
  private static readonly SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

  // Supported video extensions
  private static readonly SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

  // Supported audio extensions
  private static readonly SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma'];

  /**
   * Validate a document file (PDF, Word, etc.)
   */
  static validateDocument(filePath: string): ValidationResult {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: `File not found: ${filePath}`
      };
    }

    // Check is a file (not directory)
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return {
          valid: false,
          error: `Path is not a file: ${filePath}`
        };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Error accessing file: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Check is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      return {
        valid: false,
        error: `File is not readable: ${filePath}`
      };
    }

    // Check file extension
    const extension = path.extname(filePath).toLowerCase();
    if (!FileValidator.SUPPORTED_EXTENSIONS.includes(extension)) {
      return {
        valid: false,
        error: `Unsupported file format: ${extension || 'no extension'}. Supported formats: ${FileValidator.SUPPORTED_EXTENSIONS.join(', ')}`
      };
    }

    // Check file size
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > FileValidator.MAX_FILE_SIZE_MB) {
      return {
        valid: false,
        error: `File too large: ${sizeMB.toFixed(1)}MB (max: ${FileValidator.MAX_FILE_SIZE_MB}MB)`
      };
    }

    return {
      valid: true,
      filePath,
      size: stats.size,
      extension
    };
  }

  /**
   * Validate a PDF file (legacy method, redirects to validateDocument)
   */
  static validatePDF(filePath: string): ValidationResult {
    return FileValidator.validateDocument(filePath);
  }

  /**
   * Validate an image file
   */
  static validateImage(filePath: string): ValidationResult {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: `File not found: ${filePath}`
      };
    }

    // Check is a file (not directory)
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return {
          valid: false,
          error: `Path is not a file: ${filePath}`
        };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Error accessing file: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Check is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      return {
        valid: false,
        error: `File is not readable: ${filePath}`
      };
    }

    // Check file extension
    const extension = path.extname(filePath).toLowerCase();
    if (!FileValidator.SUPPORTED_IMAGE_EXTENSIONS.includes(extension)) {
      return {
        valid: false,
        error: `Unsupported image format: ${extension || 'no extension'}. Supported formats: ${FileValidator.SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`
      };
    }

    // Check file size
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > FileValidator.MAX_FILE_SIZE_MB) {
      return {
        valid: false,
        error: `File too large: ${sizeMB.toFixed(1)}MB (max: ${FileValidator.MAX_FILE_SIZE_MB}MB)`
      };
    }

    return {
      valid: true,
      filePath,
      size: stats.size,
      extension
    };
  }

  /**
   * Validate a video file
   */
  static validateVideo(filePath: string): ValidationResult {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: `File not found: ${filePath}`
      };
    }

    // Check is a file (not directory)
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return {
          valid: false,
          error: `Path is not a file: ${filePath}`
        };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Error accessing file: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Check is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      return {
        valid: false,
        error: `File is not readable: ${filePath}`
      };
    }

    // Check file extension
    const extension = path.extname(filePath).toLowerCase();
    if (!FileValidator.SUPPORTED_VIDEO_EXTENSIONS.includes(extension)) {
      return {
        valid: false,
        error: `Unsupported video format: ${extension || 'no extension'}. Supported formats: ${FileValidator.SUPPORTED_VIDEO_EXTENSIONS.join(', ')}`
      };
    }

    // Check file size (videos can be larger - use 500MB limit)
    const videoMaxSizeMB = parseInt(process.env.MAX_VIDEO_SIZE_MB || '500', 10);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > videoMaxSizeMB) {
      return {
        valid: false,
        error: `File too large: ${sizeMB.toFixed(1)}MB (max: ${videoMaxSizeMB}MB)`
      };
    }

    return {
      valid: true,
      filePath,
      size: stats.size,
      extension
    };
  }

  /**
   * Validate an audio file (MP3, WAV, M4A, FLAC, OGG, AAC, WMA)
   */
  static validateAudio(filePath: string): ValidationResult {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: `File not found: ${filePath}`
      };
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return {
        valid: false,
        error: `Path is not a file: ${filePath}`
      };
    }

    // Check extension
    const extension = path.extname(filePath).toLowerCase();
    if (!FileValidator.SUPPORTED_AUDIO_EXTENSIONS.includes(extension)) {
      return {
        valid: false,
        error: `Unsupported audio format: ${extension}. Supported formats: ${FileValidator.SUPPORTED_AUDIO_EXTENSIONS.join(', ')}`
      };
    }

    // Check file is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      return {
        valid: false,
        error: `File is not readable: ${filePath}`
      };
    }

    // Check file size (max 200MB for audio files)
    const audioMaxSizeMB = 200;
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > audioMaxSizeMB) {
      return {
        valid: false,
        error: `File too large: ${sizeMB.toFixed(1)}MB (max: ${audioMaxSizeMB}MB)`
      };
    }

    return {
      valid: true,
      filePath,
      size: stats.size,
      extension
    };
  }

  /**
   * Get supported file extensions
   */
  static getSupportedExtensions(): string[] {
    return [...FileValidator.SUPPORTED_EXTENSIONS];
  }

  /**
   * Get supported image extensions
   */
  static getSupportedImageExtensions(): string[] {
    return [...FileValidator.SUPPORTED_IMAGE_EXTENSIONS];
  }

  /**
   * Get supported video extensions
   */
  static getSupportedVideoExtensions(): string[] {
    return [...FileValidator.SUPPORTED_VIDEO_EXTENSIONS];
  }

  /**
   * Get supported audio extensions
   */
  static getSupportedAudioExtensions(): string[] {
    return [...FileValidator.SUPPORTED_AUDIO_EXTENSIONS];
  }

  /**
   * Validate file can be written (for output files)
   */
  static canWriteFile(filePath: string): ValidationResult {
    const dir = path.dirname(filePath);

    // Check directory exists
    if (!fs.existsSync(dir)) {
      return {
        valid: false,
        error: `Directory does not exist: ${dir}`
      };
    }

    // Check directory is writable
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (error) {
      return {
        valid: false,
        error: `Directory is not writable: ${dir}`
      };
    }

    // If file exists, check it's writable
    if (fs.existsSync(filePath)) {
      try {
        fs.accessSync(filePath, fs.constants.W_OK);
      } catch (error) {
        return {
          valid: false,
          error: `File is not writable: ${filePath}`
        };
      }
    }

    return { valid: true, filePath };
  }

  /**
   * Get human-readable file size
   */
  static formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }
}
