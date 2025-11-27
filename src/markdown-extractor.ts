import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { PDFDocument } from "./lib/types";

/**
 * Markdown extraction utilities
 * Handles markdown text extraction, frontmatter parsing, and document caching
 *
 * Supports:
 * - Plain markdown files (.md)
 * - Frontmatter metadata (YAML-style)
 * - Same caching and deduplication as PDF extraction
 */

interface MarkdownFrontmatter {
  title?: string;
  author?: string;
  date?: string;
  tags?: string[];
  [key: string]: any;
}

export class MarkdownExtractor {
  private readonly rawDocsDir = "./files/raw_docs_cache";

  constructor() {
    // Create cache directory if it doesn't exist
    if (!fs.existsSync(this.rawDocsDir)) {
      fs.mkdirSync(this.rawDocsDir, { recursive: true });
    }
  }

  /**
   * Extract text and metadata from a markdown file
   */
  async extractFromMarkdown(
    filePath: string
  ): Promise<PDFDocument | null> {
    try {
      // Read markdown file
      const content = fs.readFileSync(filePath, "utf-8");

      if (!content || content.length < 100) {
        console.error(`Insufficient content in ${filePath}`);
        return null;
      }

      // Parse frontmatter and content
      const { frontmatter, markdownContent } = this.parseFrontmatter(content);

      // Clean markdown text
      const cleanedContent = this.cleanMarkdownText(markdownContent);

      // Generate content hash for deduplication
      const contentHash = crypto
        .createHash("sha256")
        .update(cleanedContent)
        .digest("hex");

      // Extract metadata
      const fileName = path.basename(filePath);
      const title = this.extractTitle(frontmatter, fileName, markdownContent);
      const author = frontmatter?.author;
      const publicationDate = this.extractDate(frontmatter);

      const document: PDFDocument = {
        id: contentHash.substring(0, 16),
        content: cleanedContent,
        metadata: {
          fileName,
          title,
          author,
          publicationDate,
          hash: contentHash,
          pageCount: 1, // Markdown files are single "page"
          timestamp: Date.now(),
          tags: frontmatter?.tags,
          fileType: "markdown",
        },
      };

      return document;
    } catch (error) {
      console.error(
        `Error extracting markdown ${filePath}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Process a directory of markdown files
   */
  async processMarkdownDirectory(
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

    // Get all markdown files in directory
    const markdownFiles = this.findMarkdownFiles(dirPath, options?.recursive);

    // Load existing cache if collection ID provided
    let existingCache: Map<string, PDFDocument> | null = null;
    if (options?.collectionId) {
      const cached = await this.loadCachedDocuments(options.collectionId);
      if (cached.found) {
        existingCache = new Map();
        for (const doc of cached.documents) {
          existingCache.set(doc.metadata.fileName, doc);
        }
      }
    }

    if (options?.onProgress) {
      options.onProgress(`Found ${markdownFiles.length} markdown files in ${dirPath}`);
    }

    // Process each markdown file
    for (let i = 0; i < markdownFiles.length; i++) {
      const filePath = markdownFiles[i];
      const fileName = path.basename(filePath);

      // Check if file needs re-processing
      let shouldExtract = true;
      if (existingCache && existingCache.has(fileName)) {
        const cachedDoc = existingCache.get(fileName)!;
        const fileStats = fs.statSync(filePath);
        const fileModTime = fileStats.mtimeMs;
        const cachedTime = cachedDoc.metadata.timestamp;

        // If file hasn't been modified since cache, skip extraction
        if (fileModTime <= cachedTime) {
          shouldExtract = false;
          documents.push(cachedDoc);
          skippedCount++;

          if (options?.onProgress) {
            options.onProgress(`Skipped ${i + 1}/${markdownFiles.length}: ${fileName} (unchanged)`);
          }
        }
      }

      if (shouldExtract) {
        if (options?.onProgress) {
          options.onProgress(`Processing ${i + 1}/${markdownFiles.length}: ${fileName}`);
        }

        const document = await this.extractFromMarkdown(filePath);

        if (document) {
          documents.push(document);
          extractedCount++;
        } else {
          errorCount++;
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return {
      documents,
      stats: {
        total: markdownFiles.length,
        extracted: extractedCount,
        skipped: skippedCount,
        errors: errorCount,
      },
    };
  }

  /**
   * Cache extracted markdown documents (reuses PDF cache structure)
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
        unchangedCount++;
      } else {
        const existingDoc = existingDocuments.find(d => d.metadata.fileName === newDoc.metadata.fileName);
        if (existingDoc) {
          updatedCount++;
          existingDocuments = existingDocuments.filter(d => d.metadata.fileName !== newDoc.metadata.fileName);
        } else {
          addedCount++;
        }
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
   * Parse YAML-style frontmatter from markdown
   * Supports format:
   * ---
   * title: My Document
   * author: John Doe
   * date: 2025-01-15
   * tags: [ai, ml]
   * ---
   */
  private parseFrontmatter(content: string): {
    frontmatter: MarkdownFrontmatter | null;
    markdownContent: string;
  } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: null, markdownContent: content };
    }

    const [, frontmatterText, markdownContent] = match;

    // Simple YAML parsing (supports key: value format)
    const frontmatter: MarkdownFrontmatter = {};
    const lines = frontmatterText.split("\n");

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value: any = line.slice(colonIndex + 1).trim();

      // Parse arrays [item1, item2]
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((item: string) => item.trim());
      }

      frontmatter[key] = value;
    }

    return { frontmatter, markdownContent };
  }

  /**
   * Find all markdown files in a directory
   */
  private findMarkdownFiles(dirPath: string, recursive: boolean = true): string[] {
    const markdownFiles: string[] = [];

    if (!fs.existsSync(dirPath)) {
      console.error(`Directory not found: ${dirPath}`);
      return markdownFiles;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        markdownFiles.push(...this.findMarkdownFiles(fullPath, recursive));
      } else if (entry.isFile() && (entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase().endsWith('.markdown'))) {
        markdownFiles.push(fullPath);
      }
    }

    return markdownFiles;
  }

  /**
   * Clean markdown text
   * Removes excessive whitespace, normalizes line breaks
   */
  private cleanMarkdownText(text: string): string {
    return text
      // Remove NULL bytes
      .replace(/\0/g, '')
      // Normalize line breaks
      .replace(/\r\n/g, '\n')
      // Remove excessive blank lines (more than 2)
      .replace(/\n{3,}/g, '\n\n')
      // Trim lines
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      // Final trim
      .trim();
  }

  /**
   * Extract title from frontmatter, filename, or first heading
   */
  private extractTitle(
    frontmatter: MarkdownFrontmatter | null,
    fileName: string,
    content: string
  ): string {
    // Try frontmatter first
    if (frontmatter?.title) {
      return frontmatter.title.trim();
    }

    // Try first heading (# Title)
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    // Extract from filename
    let title = path.basename(fileName, path.extname(fileName))
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
   * Extract date from frontmatter
   */
  private extractDate(frontmatter: MarkdownFrontmatter | null): string | undefined {
    if (!frontmatter?.date) {
      return undefined;
    }

    const dateStr = frontmatter.date.toString();

    // Try to parse ISO date format
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    return undefined;
  }
}
