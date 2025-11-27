import { createLLMProvider, LLMProvider } from "./llm";

/**
 * Keyword Query Agent - AI-powered keyword relevance ranking
 *
 * Uses Claude to intelligently rank document chunks based on how well their
 * AI-generated keywords match the user's query. This goes beyond simple keyword
 * counting by understanding semantic relevance and title importance.
 *
 * For example, query "home education registration" should rank:
 * - Chunks with "home education registration" keywords + title mention (highest)
 * - Chunks with "home education", "registration" separately + title (high)
 * - Chunks with "home education" keywords only (medium)
 * - Chunks with "registration" in general context (low)
 */

export interface ChunkForKeywordRanking {
  id: string;
  keywords: string[];
  titleKeywords: string[]; // Keywords that appear in title (higher weight)
}

export interface RankedChunk {
  id: string;
  relevanceScore: number; // 0-100
  reasoning: string;
}

export class KeywordQueryAgent {
  private llmProvider: LLMProvider;

  constructor() {
    // Use LLM abstraction layer - defaults to OpenAI
    this.llmProvider = createLLMProvider({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
    });
  }

  /**
   * Extract JSON from LLM response, handling markdown code blocks
   */
  private extractJSON(text: string): string {
    // Remove markdown code blocks if present
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Extract JSON array (non-greedy) - matches first complete array
    const jsonArrayMatch = text.match(/(\[[\s\S]*?\])/);
    if (jsonArrayMatch) {
      try {
        // Validate it's actually valid JSON before returning
        JSON.parse(jsonArrayMatch[1]);
        return jsonArrayMatch[1];
      } catch (e) {
        // Not valid JSON, continue to next extraction method
      }
    }

    // Extract JSON object (non-greedy) - matches first complete object
    const jsonObjectMatch = text.match(/(\{[\s\S]*?\})/);
    if (jsonObjectMatch) {
      try {
        // Validate it's actually valid JSON before returning
        JSON.parse(jsonObjectMatch[1]);
        return jsonObjectMatch[1];
      } catch (e) {
        // Not valid JSON, fall through
      }
    }

    return text.trim();
  }

  /**
   * Rank chunks based on keyword relevance to query
   *
   * Uses OpenAI GPT-4o-mini to intelligently assess which chunks are most relevant
   * based on their AI-generated keywords and whether query terms appear in title
   */
  async rankChunks(
    query: string,
    chunks: ChunkForKeywordRanking[],
    topK: number = 20
  ): Promise<RankedChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    // Build a minimal representation of each chunk - keywords with title keywords marked
    const chunkSummaries = chunks.map((chunk, idx) => {
      // Mark title keywords with asterisk for higher weight
      const markedKeywords = chunk.keywords.map(kw =>
        chunk.titleKeywords.includes(kw) ? `*${kw}` : kw
      );
      return `[${idx + 1}] ${markedKeywords.join(", ")}`;
    }).join("\n");

    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    const prompt = `CURRENT DATE: ${currentDate}

Rank chunks by keyword relevance to query: "${query}"

Chunks ([number] keywords, *keyword = appears in doc title):
${chunkSummaries}

Give 3x weight to keywords with * (title keywords are more important).

IMPORTANT: Valid chunk numbers are 1 to ${chunks.length}. Return ONLY these chunk numbers.

Return JSON array of ALL ${chunks.length} chunks sorted by relevance (highest first):
[{"chunkNumber": 1, "relevanceScore": 95}, {"chunkNumber": 2, "relevanceScore": 92}, ...]

Scoring: 90-100 (multiple relevant + title keywords), 70-89 (multiple relevant OR title), 50-69 (some), 30-49 (few), 0-29 (minimal).
NO ties. NO duplicate chunk numbers. Return ALL ${chunks.length} chunks.`;

    let response;
    try {
      response = await this.llmProvider.generate(
        [
          {
            role: "user",
            content: prompt,
          },
        ],
        {
          maxTokens: 4000,
          temperature: 0.3, // Slight temperature for score diversity
        }
      );

      const jsonText = this.extractJSON(response.content);
      const parsed = JSON.parse(jsonText);

      // Handle both array and single object responses
      let rankings: Array<{
        chunkNumber: number;
        relevanceScore: number;
      }>;

      if (Array.isArray(parsed)) {
        rankings = parsed;
      } else if (typeof parsed === 'object' && parsed !== null && 'chunkNumber' in parsed) {
        // LLM returned a single object instead of array - wrap it
        console.warn("LLM returned single object instead of array, wrapping in array");
        rankings = [parsed];
      } else {
        console.error("Expected array or ranking object from LLM, got:", typeof parsed);
        console.error("Parsed value:", parsed);
        throw new Error("LLM returned unexpected JSON format");
      }

      // Convert chunk numbers back to IDs and normalize scores with validation
      const rankedChunks: RankedChunk[] = rankings
        .filter((rank) => {
          const chunkIndex = rank.chunkNumber - 1;
          if (chunkIndex < 0 || chunkIndex >= chunks.length) {
            console.warn(`Invalid chunkNumber ${rank.chunkNumber}, skipping (valid range: 1-${chunks.length})`);
            return false;
          }
          if (!chunks[chunkIndex]?.id) {
            console.warn(`Chunk at index ${chunkIndex} missing id, skipping`);
            return false;
          }
          return true;
        })
        .map((rank) => ({
          id: chunks[rank.chunkNumber - 1].id,
          relevanceScore: rank.relevanceScore / 100, // Normalize to 0-1 range
          reasoning: "", // No reasoning in minimal prompt
        }));

      // Return top K results
      return rankedChunks
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, topK);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Keyword query agent failed:", errorMessage);
      console.error("Full error:", error);

      // If JSON parse error, try to show the actual response
      if (error instanceof SyntaxError && response) {
        console.error("LLM's actual response (first 500 chars):");
        console.error(response.content.substring(0, 500));
      }

      // Fallback: return empty results rather than crashing
      return [];
    }
  }

}
