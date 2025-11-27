/**
 * Document chunking utilities for preparing text for vector databases
 * Uses intelligent paragraph-based chunking with token-aware splitting
 */

export class Chunker {
  /**
   * Split text into chunks by paragraph boundaries, with sentence and legal-text fallback
   *
   * Design decisions:
   * - Preserves semantic boundaries (paragraph breaks) for better context
   * - Falls back to sentence chunking when paragraphs are too large
   * - Falls back to list-item splitting for legal/legislative text
   * - Uses actual token counting during chunking (not character heuristics)
   * - Avoids overlapping chunks to maintain clean semantic boundaries
   *
   * @param text - The text to chunk
   * @param maxTokens - Maximum number of tokens per chunk (e.g., 384 for all-mpnet-base-v2)
   * @param tokenCounter - Async function that counts tokens in text
   * @returns Array of text chunks
   */
  static async chunkByParagraph(
    text: string,
    maxTokens: number,
    tokenCounter: (text: string) => Promise<number>
  ): Promise<string[]> {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      // Check if paragraph itself exceeds token limit (needs splitting)
      const paragraphTokens = await tokenCounter(paragraph);

      if (paragraphTokens > maxTokens) {
        // Paragraph too large - save current chunk and split this paragraph
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }

        // Split into sentences and accumulate until we hit the limit
        const sentences = this.splitBySentence(paragraph);
        let sentenceChunk = "";

        for (const sentence of sentences) {
          // Try adding this sentence
          const testChunk = sentenceChunk ? sentenceChunk + " " + sentence : sentence;
          const testTokens = await tokenCounter(testChunk);

          if (testTokens > maxTokens) {
            // Adding this sentence would exceed limit
            if (sentenceChunk) {
              // Save what we have so far
              chunks.push(sentenceChunk.trim());
              // Check if single sentence is too large (rare case)
              const singleSentenceTokens = await tokenCounter(sentence);
              if (singleSentenceTokens > maxTokens) {
                // Single sentence exceeds limit - force split by characters
                const characterSplits = await this.splitByCharacters(sentence, maxTokens, tokenCounter);
                chunks.push(...characterSplits);
                sentenceChunk = "";
              } else {
                // Start new chunk with this sentence
                sentenceChunk = sentence;
              }
            } else {
              // First sentence itself exceeds limit (rare case) - force split by characters
              const characterSplits = await this.splitByCharacters(sentence, maxTokens, tokenCounter);
              chunks.push(...characterSplits);
              sentenceChunk = "";
            }
          } else {
            // Sentence fits - add it to the chunk
            sentenceChunk = testChunk;
          }
        }

        // Don't forget the last sentence chunk
        if (sentenceChunk) {
          chunks.push(sentenceChunk.trim());
        }

        continue;
      }

      // Check if adding this paragraph would exceed the token limit
      const testChunk = currentChunk ? currentChunk + "\n\n" + paragraph : paragraph;
      const testTokens = await tokenCounter(testChunk);

      if (testTokens > maxTokens && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk = testChunk;
      }
    }

    // Don't forget the last chunk
    if (currentChunk) {
      // Final safety check: ensure last chunk doesn't exceed limit
      const finalTokens = await tokenCounter(currentChunk);
      if (finalTokens > maxTokens) {
        const characterSplits = await this.splitByCharacters(currentChunk, maxTokens, tokenCounter);
        chunks.push(...characterSplits);
      } else {
        chunks.push(currentChunk.trim());
      }
    }

    return chunks;
  }

  /**
   * Split legal/legislative text by list items
   * Matches patterns like: (a), (b), (c), (i), (ii), (iii), etc.
   */
  private static splitByListItems(text: string): string[] {
    // Split on list item markers: (a), (b), (i), (ii), etc.
    // Preserve the marker in the split result
    const parts = text.split(/(?=\n\s*\([a-z]+\)|\n\s*\([ivxlcdm]+\))/i);
    return parts.filter((p) => p.trim().length > 0);
  }

  /**
   * Split text into sentences - used internally for fallback chunking
   * @param text - The text to split
   * @returns Array of sentences
   */
  private static splitBySentence(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Split text by characters when all semantic splitting fails
   * Uses binary search to find the maximum text that fits within token limit
   * @param text - The text to split
   * @param maxTokens - Maximum tokens per chunk
   * @param tokenCounter - Function to count tokens
   * @returns Array of chunks that fit within token limit
   */
  private static async splitByCharacters(
    text: string,
    maxTokens: number,
    tokenCounter: (text: string) => Promise<number>
  ): Promise<string[]> {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      const tokens = await tokenCounter(remaining);

      if (tokens <= maxTokens) {
        // Remaining text fits
        chunks.push(remaining.trim());
        break;
      }

      // Binary search to find the split point
      let left = 0;
      let right = remaining.length;
      let bestSplit = 0; // Start at 0, only update when we find valid split

      while (left < right - 1) {
        const mid = Math.floor((left + right) / 2);
        const candidate = remaining.substring(0, mid);
        const candidateTokens = await tokenCounter(candidate);

        if (candidateTokens <= maxTokens) {
          bestSplit = mid;
          left = mid;
        } else {
          right = mid;
        }
      }

      // Safety check: if no valid split found, take minimal chunk
      if (bestSplit === 0) {
        // Couldn't find any valid split - take 10 characters and hope for the best
        bestSplit = Math.min(10, remaining.length);
      }

      // Take the chunk and continue with the rest
      chunks.push(remaining.substring(0, bestSplit).trim());
      remaining = remaining.substring(bestSplit).trim();
    }

    return chunks;
  }

}