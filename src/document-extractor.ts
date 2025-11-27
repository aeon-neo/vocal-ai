/**
 * Unified Document Extractor
 *
 * Extracts text from multiple document formats:
 * - PDF (.pdf)
 * - Word Documents (.docx, .doc)
 * - Markdown (.md, .markdown)
 * - Rich Text Format (.rtf)
 * - OpenDocument Text (.odt)
 *
 * Returns a standardized ExtractedDocument interface regardless of source format.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { MarkdownExtractor } from './markdown-extractor';

export interface ExtractedDocument {
  content: string;
  metadata: {
    title: string;
    pageCount?: number;
    format: string;
    fileSize: number;
    hash: string; // SHA-256 hash of content for deduplication
  };
}

export interface ExtractionResult {
  success: boolean;
  document?: ExtractedDocument;
  error?: string;
}

/**
 * Document Extractor Class
 *
 * Detects file format and routes to appropriate extraction method.
 */
export class DocumentExtractor {
  /**
   * Extract text from PDF document
   */
  async extractFromPDF(filePath: string): Promise<ExtractedDocument | null> {
    try {
      const dataBuffer = fs.readFileSync(filePath);

      // Parse PDF - convert Buffer to Uint8Array
      const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });

      // Extract text and metadata
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();

      await parser.destroy();

      const content = textResult.text;

      // Extract title from metadata or filename
      const fileName = path.basename(filePath, '.pdf');
      const title = infoResult.info?.Title || fileName;

      // Generate content hash for deduplication
      const contentHash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex');

      return {
        content,
        metadata: {
          title,
          pageCount: textResult.pages.length,
          format: 'pdf',
          fileSize: dataBuffer.length,
          hash: contentHash
        }
      };
    } catch (error) {
      console.error(`Error extracting PDF ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract text from Word document (.docx)
   */
  async extractFromDOCX(filePath: string): Promise<ExtractedDocument | null> {
    try {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });

      // Extract title from filename (Word docs don't have reliable title metadata)
      const fileName = path.basename(filePath, path.extname(filePath));

      // Generate content hash for deduplication
      const contentHash = crypto
        .createHash('sha256')
        .update(result.value)
        .digest('hex');

      return {
        content: result.value,
        metadata: {
          title: fileName,
          format: 'docx',
          fileSize: buffer.length,
          hash: contentHash
        }
      };
    } catch (error) {
      console.error(`Error extracting DOCX ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract text from Markdown document (.md, .markdown)
   */
  async extractFromMarkdown(filePath: string): Promise<ExtractedDocument | null> {
    try {
      const markdownExtractor = new MarkdownExtractor();
      const pdfDoc = await markdownExtractor.extractFromMarkdown(filePath);

      if (!pdfDoc) {
        return null;
      }

      // Convert PDFDocument format to ExtractedDocument format
      return {
        content: pdfDoc.content,
        metadata: {
          title: pdfDoc.metadata.title,
          format: 'markdown',
          fileSize: fs.statSync(filePath).size,
          hash: pdfDoc.metadata.hash
        }
      };
    } catch (error) {
      console.error(`Error extracting Markdown ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract text from any supported document format
   *
   * Auto-detects format based on file extension.
   */
  async extractDocument(filePath: string): Promise<ExtractionResult> {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`
      };
    }

    const ext = path.extname(filePath).toLowerCase();

    try {
      let document: ExtractedDocument | null = null;

      switch (ext) {
        case '.pdf':
          document = await this.extractFromPDF(filePath);
          break;

        case '.docx':
        case '.doc':
          document = await this.extractFromDOCX(filePath);
          break;

        case '.md':
        case '.markdown':
          document = await this.extractFromMarkdown(filePath);
          break;

        default:
          return {
            success: false,
            error: `Unsupported file format: ${ext}. Supported formats: .pdf, .docx, .doc, .md, .markdown`
          };
      }

      if (!document) {
        return {
          success: false,
          error: `Failed to extract text from ${ext} file`
        };
      }

      return {
        success: true,
        document
      };

    } catch (error) {
      return {
        success: false,
        error: `Extraction failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get supported file extensions
   */
  static getSupportedExtensions(): string[] {
    return ['.pdf', '.docx', '.doc', '.md', '.markdown'];
  }

  /**
   * Check if file format is supported
   */
  static isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return DocumentExtractor.getSupportedExtensions().includes(ext);
  }
}
