import * as fs from 'fs';
import * as path from 'path';

/**
 * Image Extractor
 *
 * Loads and processes image files for Claude Vision API.
 * Supports common image formats: JPEG, PNG, GIF, WebP, BMP.
 */

export interface ImageData {
  base64: string;
  mediaType: string;
  width?: number;
  height?: number;
  size: number;
  format: string;
}

export interface ExtractImageResult {
  success: boolean;
  image?: ImageData;
  error?: string;
}

export class ImageExtractor {
  /**
   * Extract image data from file path
   * Loads image, converts to base64, and extracts metadata
   */
  async extractImage(filePath: string): Promise<ExtractImageResult> {
    try {
      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `Image file not found: ${filePath}`
        };
      }

      // Get file stats
      const stats = fs.statSync(filePath);
      const extension = path.extname(filePath).toLowerCase();

      // Map extension to media type
      const mediaType = this.getMediaType(extension);
      if (!mediaType) {
        return {
          success: false,
          error: `Unsupported image format: ${extension}`
        };
      }

      // Read file and convert to base64
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');

      // Try to extract dimensions using simple image header parsing
      const dimensions = this.extractDimensions(buffer, extension);

      return {
        success: true,
        image: {
          base64,
          mediaType,
          width: dimensions?.width,
          height: dimensions?.height,
          size: stats.size,
          format: extension.substring(1) // Remove leading dot
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to extract image: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get media type for Claude API from file extension
   */
  private getMediaType(extension: string): string | null {
    const mediaTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    return mediaTypes[extension] || null;
  }

  /**
   * Extract image dimensions from buffer
   * Simple header parsing for common formats
   */
  private extractDimensions(buffer: Buffer, extension: string): { width: number; height: number } | null {
    try {
      switch (extension) {
        case '.png':
          return this.parsePNGDimensions(buffer);
        case '.jpg':
        case '.jpeg':
          return this.parseJPEGDimensions(buffer);
        case '.gif':
          return this.parseGIFDimensions(buffer);
        default:
          return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse PNG dimensions from buffer
   */
  private parsePNGDimensions(buffer: Buffer): { width: number; height: number } | null {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    // IHDR chunk at offset 8, dimensions at offset 16
    if (buffer.length < 24) return null;

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    return { width, height };
  }

  /**
   * Parse JPEG dimensions from buffer
   */
  private parseJPEGDimensions(buffer: Buffer): { width: number; height: number } | null {
    // JPEG markers: FF D8 (SOI), FF C0/C2 (SOF)
    if (buffer.length < 10) return null;

    let offset = 2; // Skip SOI marker

    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xFF) break;

      const marker = buffer[offset + 1];

      // SOF0 (0xC0) or SOF2 (0xC2) marker contains dimensions
      if (marker === 0xC0 || marker === 0xC2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }

      // Skip to next marker
      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }

    return null;
  }

  /**
   * Parse GIF dimensions from buffer
   */
  private parseGIFDimensions(buffer: Buffer): { width: number; height: number } | null {
    // GIF signature: GIF87a or GIF89a
    // Dimensions at offset 6 (little-endian)
    if (buffer.length < 10) return null;

    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);

    return { width, height };
  }

  /**
   * Format image data for Claude API message content
   */
  formatForClaude(image: ImageData): any {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.base64
      }
    };
  }
}
