import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Filename Matching Utility
 *
 * Provides fuzzy filename matching for document, image, and video files.
 * Supports partial matches, case-insensitive matching, and extension-optional queries.
 * Supports multiple formats:
 * - Documents: PDF, Word (.docx, .doc), Markdown (.md, .markdown)
 * - Images: JPEG, PNG, GIF, WebP, BMP
 * - Videos: MP4, MOV, AVI, MKV, WebM
 */

export interface FileMatch {
  fileName: string;
  fullPath: string;
  score: number; // 0-1, higher is better match
}

// Supported extensions (documents, images, videos, audio)
const SUPPORTED_EXTENSIONS = [
  // Documents
  '.pdf', '.docx', '.doc', '.md', '.markdown',
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  // Videos
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  // Audio
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma'
];

/**
 * Expand tilde (~) to home directory
 */
export function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

/**
 * Get document directory from environment or default
 */
export function getDocumentDirectory(): string {
  const docDir = process.env.DOCUMENT_DIRECTORY || '~/niimi-documents';
  return expandTilde(docDir);
}

/**
 * List all supported files in the document directory (recursive)
 *
 * Scans for:
 * - Documents: PDF, Word (.docx, .doc), Markdown (.md, .markdown)
 * - Images: JPEG, PNG, GIF, WebP, BMP
 * - Videos: MP4, MOV, AVI, MKV, WebM
 */
export function listDocuments(): string[] {
  const docDir = getDocumentDirectory();

  if (!fs.existsSync(docDir)) {
    return [];
  }

  const files: string[] = [];

  function scanDirectory(dir: string, relativePath: string = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          scanDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          // Check if file has supported extension
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            files.push(relPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }

  scanDirectory(docDir);
  return files;
}

/**
 * Find matching files based on query
 *
 * Matching strategy:
 * 1. Exact match (case-insensitive)
 * 2. All query words appear in filename
 * 3. Score based on word matches and position
 *
 * Supports all formats: Documents (PDF, Word), Images (JPEG, PNG, etc.), Videos (MP4, MOV, etc.)
 */
export function findMatchingFiles(query: string): FileMatch[] {
  const allFiles = listDocuments();
  const docDir = getDocumentDirectory();

  if (allFiles.length === 0) {
    return [];
  }

  // Normalize query: lowercase, remove any document extension
  let normalizedQuery = query.toLowerCase();
  for (const ext of SUPPORTED_EXTENSIONS) {
    normalizedQuery = normalizedQuery.replace(new RegExp(`\\${ext}$`, 'i'), '');
  }
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

  const matches: FileMatch[] = [];

  for (const fileName of allFiles) {
    // Normalize filename: remove extension
    let normalizedFileName = fileName.toLowerCase();
    for (const ext of SUPPORTED_EXTENSIONS) {
      normalizedFileName = normalizedFileName.replace(new RegExp(`\\${ext}$`, 'i'), '');
    }

    // Exact match (highest score)
    if (normalizedFileName === normalizedQuery) {
      matches.push({
        fileName,
        fullPath: path.join(docDir, fileName),
        score: 1.0
      });
      continue;
    }

    // Check if all query words appear in filename
    const allWordsMatch = queryWords.every(word =>
      normalizedFileName.includes(word)
    );

    if (allWordsMatch) {
      // Calculate score based on:
      // - Number of matching words
      // - Position of matches (earlier is better)
      // - Length of filename (shorter is more specific)

      let score = 0;

      for (const word of queryWords) {
        const index = normalizedFileName.indexOf(word);
        if (index !== -1) {
          // Earlier matches score higher
          const positionScore = 1 - (index / normalizedFileName.length);
          score += positionScore;
        }
      }

      // Normalize score
      score = score / queryWords.length;

      // Bonus for fewer extra words (more specific match)
      const fileWords = normalizedFileName.split(/[-_\s]+/);
      const specificityBonus = queryWords.length / fileWords.length;
      score = score * 0.7 + specificityBonus * 0.3;

      matches.push({
        fileName,
        fullPath: path.join(docDir, fileName),
        score
      });
    }
  }

  // Sort by score (highest first)
  matches.sort((a, b) => b.score - a.score);

  return matches;
}

/**
 * Resolve filename or path to full path
 *
 * If input is just a filename, looks in document directory.
 * If input is a relative path, tries document directory first, then CWD.
 * If input is an absolute path, validates it exists.
 */
export function resolvePath(fileNameOrPath: string): string | null {
  const docDir = getDocumentDirectory();

  // If it's an absolute path, check if it exists
  if (path.isAbsolute(fileNameOrPath)) {
    if (fs.existsSync(fileNameOrPath)) {
      return fileNameOrPath;
    }
    return null;
  }

  // Try as path relative to document directory first
  // This handles both simple filenames AND subdirectory paths like "research/KIT Deck.pdf"
  const pathInDocDir = path.join(docDir, fileNameOrPath);
  if (fs.existsSync(pathInDocDir)) {
    return pathInDocDir;
  }

  // If it contains path separators, try as relative path from CWD
  if (fileNameOrPath.includes('/') || fileNameOrPath.includes('\\')) {
    const resolved = path.resolve(fileNameOrPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

/**
 * Get best match for a query
 *
 * Returns single best match if unambiguous (score > 0.7 and significantly better than second),
 * otherwise returns all matches for user to choose from.
 */
export function getBestMatch(query: string): FileMatch[] {
  const matches = findMatchingFiles(query);

  if (matches.length === 0) {
    return [];
  }

  if (matches.length === 1) {
    return matches;
  }

  // If best match is significantly better than second (0.2 difference) and has high score,
  // return only best match
  const best = matches[0];
  const second = matches[1];

  if (best.score > 0.7 && (best.score - second.score) > 0.2) {
    return [best];
  }

  // Otherwise, return all matches for disambiguation
  return matches;
}
