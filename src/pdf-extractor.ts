import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PDFParse } from "pdf-parse";
import { PDFDocument } from "./lib/types";

/**
 * PDF extraction utilities for CWSB compliance documents
 * Handles PDF text extraction, metadata generation, and document caching
 */

export class PDFExtractor {
  private readonly rawDocsDir = "./files/raw_docs_cache";

  constructor() {
    // Create cache directory if it doesn't exist
    if (!fs.existsSync(this.rawDocsDir)) {
      fs.mkdirSync(this.rawDocsDir, { recursive: true });
    }
  }

  /**
   * Extract text from a single PDF file
   */
  async extractFromPDF(
    filePath: string
  ): Promise<PDFDocument | null> {
    try {
      // Read PDF file
      const dataBuffer = fs.readFileSync(filePath);

      // Parse PDF - convert Buffer to Uint8Array
      const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });

      // Extract text and metadata
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();

      await parser.destroy();

      // Extract text content
      const content = this.cleanPDFText(textResult.text);

      if (!content || content.length < 100) {
        console.error(`Insufficient content extracted from ${filePath}`);
        return null;
      }

      // Generate content hash for deduplication
      const contentHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      // Extract metadata
      const fileName = path.basename(filePath);
      const title = this.extractTitle(infoResult.info, fileName);
      const author = this.extractAuthor(infoResult.info);
      const publicationDate = this.extractPublicationDate(infoResult.info);

      const document: PDFDocument = {
        id: contentHash.substring(0, 16),
        content,
        metadata: {
          fileName,
          title,
          author,
          publicationDate,
          hash: contentHash,
          pageCount: textResult.pages.length,
          timestamp: Date.now(),
        },
      };

      return document;
    } catch (error) {
      console.error(
        `Error extracting PDF ${filePath}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Process a directory of PDF files
   */
  async processPDFDirectory(
    dirPath: string,
    options?: {
      collectionId?: string;
      recursive?: boolean;
      onProgress?: (message: string) => void;
    }
  ): Promise<{
    documents: PDFDocument[];
    stats: {
      total: number;
      extracted: number;
      skipped: number;
      errors: number;
    };
  }> {
    const documents: PDFDocument[] = [];
    let extractedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Get all PDF files in directory
    const pdfFiles = this.findPDFFiles(dirPath, options?.recursive);

    // Load existing cache if collection ID provided
    let existingCache: Map<string, PDFDocument> | null = null;
    if (options?.collectionId) {
      const cached = await this.loadCachedDocuments(options.collectionId);
      if (cached.found) {
        existingCache = new Map();
        for (const doc of cached.documents) {
          // Key by filename for quick lookup
          existingCache.set(doc.metadata.fileName, doc);
        }
      }
    }

    if (options?.onProgress) {
      options.onProgress(`Found ${pdfFiles.length} PDF files in ${dirPath}`);
    }

    // Process each PDF
    for (let i = 0; i < pdfFiles.length; i++) {
      const filePath = pdfFiles[i];
      const fileName = path.basename(filePath);

      // Check if file needs re-processing by comparing modification time and cached hash
      let shouldExtract = true;
      if (existingCache && existingCache.has(fileName)) {
        const cachedDoc = existingCache.get(fileName)!;
        const fileStats = fs.statSync(filePath);
        const fileModTime = fileStats.mtimeMs;
        const cachedTime = cachedDoc.metadata.timestamp;

        // If file hasn't been modified since cache, skip extraction
        if (fileModTime <= cachedTime) {
          shouldExtract = false;
          documents.push(cachedDoc); // Use cached version
          skippedCount++;

          if (options?.onProgress) {
            options.onProgress(`Skipped ${i + 1}/${pdfFiles.length}: ${fileName} (unchanged)`);
          }
        }
      }

      if (shouldExtract) {
        if (options?.onProgress) {
          options.onProgress(`Processing ${i + 1}/${pdfFiles.length}: ${fileName}`);
        }

        const document = await this.extractFromPDF(filePath);

        if (document) {
          documents.push(document);
          extractedCount++;
        } else {
          errorCount++;
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return {
      documents,
      stats: {
        total: pdfFiles.length,
        extracted: extractedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
    };
  }

  /**
   * Cache extracted documents to JSON file with intelligent deduplication
   * Uses content hash to avoid re-processing unchanged PDFs
   */
  async cacheDocuments(
    collectionId: string,
    documents: PDFDocument[]
  ): Promise<string> {
    const cacheFile = path.join(this.rawDocsDir, `${collectionId}_raw_docs.json`);

    // Load existing cache if it exists
    let existingDocuments: PDFDocument[] = [];
    if (fs.existsSync(cacheFile)) {
      const existingData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      existingDocuments = existingData.documents || [];
    }

    // Build hash map of existing documents
    const existingHashes = new Map<string, PDFDocument>();
    for (const doc of existingDocuments) {
      existingHashes.set(doc.metadata.hash, doc);
    }

    // Merge: keep existing docs + add new/updated docs
    let addedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const newDoc of documents) {
      const hash = newDoc.metadata.hash;

      if (existingHashes.has(hash)) {
        // Document unchanged, keep existing version
        unchangedCount++;
      } else {
        // New or updated document
        const existingDoc = existingDocuments.find(d => d.metadata.fileName === newDoc.metadata.fileName);
        if (existingDoc) {
          // Same filename, different content = updated
          updatedCount++;
          // Remove old version
          existingDocuments = existingDocuments.filter(d => d.metadata.fileName !== newDoc.metadata.fileName);
        } else {
          // New document
          addedCount++;
        }
        // Add new/updated version
        existingDocuments.push(newDoc);
      }
    }

    const data = {
      collectionId,
      lastUpdated: Date.now(),
      documentCount: existingDocuments.length,
      documents: existingDocuments,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));

    console.log(`Cached to ${cacheFile}:`);
    console.log(`  Total documents: ${existingDocuments.length}`);
    console.log(`  Added: ${addedCount}, Updated: ${updatedCount}, Unchanged: ${unchangedCount}`);

    return cacheFile;
  }

  /**
   * Load cached documents
   */
  async loadCachedDocuments(
    collectionId: string
  ): Promise<{
    found: boolean;
    documents: PDFDocument[];
    metadata?: any;
  }> {
    const cacheFile = path.join(this.rawDocsDir, `${collectionId}_raw_docs.json`);

    if (!fs.existsSync(cacheFile)) {
      return { found: false, documents: [] };
    }

    const data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));

    return {
      found: true,
      documents: data.documents || [],
      metadata: {
        lastUpdated: data.lastUpdated,
        collectionId: data.collectionId,
        documentCount: data.documentCount,
      },
    };
  }

  /**
   * Find all PDF files in a directory
   */
  private findPDFFiles(dirPath: string, recursive: boolean = true): string[] {
    const pdfFiles: string[] = [];

    if (!fs.existsSync(dirPath)) {
      console.error(`Directory not found: ${dirPath}`);
      return pdfFiles;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        pdfFiles.push(...this.findPDFFiles(fullPath, recursive));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push(fullPath);
      }
    }

    return pdfFiles;
  }

  /**
   * Clean extracted PDF text
   * Removes NULL bytes, excessive whitespace, normalizes line breaks
   */
  private cleanPDFText(text: string): string {
    return text
      // Remove NULL bytes (0x00) - PostgreSQL TEXT fields don't allow them
      .replace(/\0/g, '')
      // Normalize line breaks
      .replace(/\r\n/g, '\n')
      // Remove excessive blank lines (more than 2)
      .replace(/\n{3,}/g, '\n\n')
      // Remove trailing/leading whitespace on lines
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      // Final trim
      .trim();
  }

  /**
   * Extract title from PDF metadata or filename
   */
  private extractTitle(pdfData: any, fileName: string): string {
    // Try PDF metadata first
    if (pdfData.info && pdfData.info.Title) {
      return pdfData.info.Title.trim();
    }

    // Extract from filename
    // Remove extension and common prefixes
    let title = path.basename(fileName, '.pdf')
      .replace(/^(draft|final|v\d+)[-_]/i, '')
      .replace(/[-_]/g, ' ')
      .trim();

    // Capitalize first letter of each word
    title = title
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    return title || 'Untitled Document';
  }

  /**
   * Extract author from PDF metadata
   */
  private extractAuthor(pdfData: any): string | undefined {
    // Try PDF metadata Author field
    if (pdfData && pdfData.Author) {
      const author = pdfData.Author.trim();
      // Only return if non-empty
      return author.length > 0 ? author : undefined;
    }

    return undefined;
  }

  /**
   * Extract publication date from PDF metadata
   */
  private extractPublicationDate(pdfData: any): string | undefined {
    // Try PDF metadata CreationDate field
    if (pdfData && pdfData.CreationDate) {
      const dateStr = pdfData.CreationDate;

      // PDF dates are in format "D:YYYYMMDDHHmmSSOHH'mm'" or similar
      // Extract year, month, day using regex
      const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})/);
      if (match) {
        const year = match[1];
        const month = match[2];
        const day = match[3];

        // Return ISO date format YYYY-MM-DD
        return `${year}-${month}-${day}`;
      }
    }

    return undefined;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalCollections: number;
    collections: Array<{
      id: string;
      documentCount: number;
      lastUpdated: Date;
    }>;
  } {
    if (!fs.existsSync(this.rawDocsDir)) {
      return { totalCollections: 0, collections: [] };
    }

    const files = fs.readdirSync(this.rawDocsDir)
      .filter(f => f.endsWith('_raw_docs.json'));

    const collections = files.map(file => {
      const data = JSON.parse(
        fs.readFileSync(path.join(this.rawDocsDir, file), 'utf8')
      );
      return {
        id: data.collectionId,
        documentCount: data.documentCount || data.documents?.length || 0,
        lastUpdated: new Date(data.lastUpdated),
      };
    });

    return {
      totalCollections: collections.length,
      collections,
    };
  }
}
