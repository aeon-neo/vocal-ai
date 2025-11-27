/**
 * AI-powered chunk keyword extraction using OpenAI
 * Extracts semantic keywords for each chunk to enable precise lexical search
 */

import OpenAI from "openai";

export interface ChunkKeywords {
  chunkId: string;
  keywords: string[];
}

export class ChunkKeywordExtractor {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Extract keywords for multiple chunks in batch using OpenAI
   * Processes up to 20 chunks per API call for efficiency
   */
  async extractKeywordsForChunks(
    chunks: Array<{
      id: string;
      text: string;
      title?: string;
      fileName?: string;
      documentTaxonomy?: any; // AI-generated document taxonomy with topics, tags, entities
    }>,
    collectionName: string
  ): Promise<Map<string, string[]>> {
    const results = new Map<string, string[]>();
    const batchSize = 20; // Process 20 chunks per API call

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchResults = await this.extractBatch(batch, collectionName);

      // Merge results
      batchResults.forEach((keywords, chunkId) => {
        results.set(chunkId, keywords);
      });

      // Progress logging
      console.log(`  Processed ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks`);
    }

    return results;
  }

  /**
   * Extract keywords from document taxonomy
   * Uses AI to intelligently extract searchable keywords from taxonomy metadata
   */
  private extractKeywordsFromTaxonomy(taxonomy: any): string[] {
    if (!taxonomy) return [];

    const keywords: string[] = [];

    // Extract from tags (already in keyword format)
    if (taxonomy.tags && Array.isArray(taxonomy.tags)) {
      taxonomy.tags.forEach((tag: string) => {
        // Convert hyphenated tags to both forms
        keywords.push(tag); // "key-stage-4"
        keywords.push(tag.replace(/-/g, ' ')); // "key stage 4"
      });
    }

    // Extract from mainTopics (need to extract keywords using AI)
    if (taxonomy.mainTopics && Array.isArray(taxonomy.mainTopics)) {
      taxonomy.mainTopics.forEach((topic: string) => {
        // Simple tokenization - could use Claude for better extraction
        const topicKeywords = topic
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(word => word.length > 2);
        keywords.push(...topicKeywords);
      });
    }

    // Extract from keyEntities
    if (taxonomy.keyEntities && Array.isArray(taxonomy.keyEntities)) {
      taxonomy.keyEntities.forEach((entity: string) => {
        const entityKeywords = entity
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(word => word.length > 2);
        keywords.push(...entityKeywords);
      });
    }

    // Deduplicate
    return [...new Set(keywords)];
  }

  /**
   * Extract keywords for a batch of chunks using a single OpenAI API call
   */
  private async extractBatch(
    chunks: Array<{
      id: string;
      text: string;
      title?: string;
      fileName?: string;
      documentTaxonomy?: any;
    }>,
    collectionName: string
  ): Promise<Map<string, string[]>> {
    // Build the prompt with all chunks
    const chunksText = chunks
      .map((chunk, idx) => {
        const title = chunk.title ? `\nDocument: ${chunk.title}` : '';
        const fileName = chunk.fileName ? `\nFile: ${chunk.fileName}` : '';

        // Include document taxonomy context if available
        let taxonomyContext = '';
        if (chunk.documentTaxonomy) {
          const topics = chunk.documentTaxonomy.mainTopics?.slice(0, 3).join(', ') || '';
          const docType = chunk.documentTaxonomy.documentType || '';
          if (topics || docType) {
            taxonomyContext = `\nDocument context: ${docType ? docType + ' - ' : ''}${topics}`;
          }
        }

        return `[CHUNK_${idx}]${title}${fileName}${taxonomyContext}\n${chunk.text.substring(0, 800)}`;
      })
      .join('\n\n---\n\n');

    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    const prompt = `CURRENT DATE: ${currentDate}

You are an intelligent keyword extractor. Extract 5-10 semantic keywords for each chunk that someone would use when SEARCHING for this information.

Think like a searcher: What would someone type to find this content?

Collection: ${collectionName}

Extraction Strategy:

1. TOPICS & CONCEPTS (most important!)
   - What is this chunk ABOUT? Extract the main topic/concept
   - Example: "About the Founders" section -> extract "founders", "co-founders", "leadership"
   - Example: "Who founded X?" -> extract "founded", "founders", "creation", "origin"

2. SECTION HEADINGS & FAQ QUESTIONS
   - Extract keywords from headings (e.g., "About the Founders" -> "founders")
   - Extract keywords from questions (e.g., "Who is Mike Fairclough?" -> "Mike Fairclough", "founder", "biography")

3. ENTITIES & ROLES
   - Extract person names, organizations, locations
   - When people are mentioned, infer their roles (e.g., if Mike appears in founder context -> "founder", "co-founder")

4. SPECIFIC TERMS
   - Legal terms, procedures, technical concepts from content
   - Use full forms (e.g., "elective home education" not "EHE")

5. SEARCH VARIATIONS
   - Include both singular and plural if relevant (e.g., "founder" AND "founders")
   - Include common synonyms (e.g., "created by", "founded by", "established")

6. UK EDUCATION EQUIVALENTS (CRITICAL for curriculum content):
   If content mentions year groups or key stages, INCLUDE ALL EQUIVALENT TERMS:
   - "year 11" -> ALSO include: "key stage 4", "ks4", "gcse"
   - "year 10" -> ALSO include: "key stage 4", "ks4"
   - "year 9" -> ALSO include: "key stage 3", "ks3"
   - "year 8" -> ALSO include: "key stage 3", "ks3"
   - "year 7" -> ALSO include: "key stage 3", "ks3"
   - "key stage 4" or "ks4" -> ALSO include: "year 10", "year 11", "gcse"
   - "key stage 3" or "ks3" -> ALSO include: "year 7", "year 8", "year 9"
   - "gcse" -> ALSO include: "key stage 4", "ks4", "year 11"
   - "mathematics" -> ALSO include: "maths"
   - "science" -> ALSO include: "sciences"

Requirements:
- ALWAYS include "${collectionName}" as first keyword
- Extract 5-10 keywords total (more if including UK education equivalents)
- Keywords must be grounded in the chunk (no hallucinations)
- Think: "What would someone searching for this type in Google?"

Chunks:
${chunksText}

Return ONLY JSON (no markdown, no explanation):
{"chunks":[{"index":0,"keywords":["${collectionName}","keyword1","keyword2"]},{"index":1,"keywords":["${collectionName}","keyword1","keyword2"]}]}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4000,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      // Parse response
      const content = response.choices[0]?.message?.content || "{}";

      // Extract JSON from response (handle markdown code blocks and extra text)
      let jsonText = content.trim();

      // Remove markdown code blocks if present
      if (jsonText.includes("```")) {
        const match = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (match) {
          jsonText = match[1].trim();
        }
      }

      // Try to extract JSON object if there's extra text
      if (!jsonText.startsWith("{")) {
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      const parsed = JSON.parse(jsonText);

      // Build results map with taxonomy keyword enrichment
      const results = new Map<string, string[]>();
      parsed.chunks.forEach((item: any) => {
        const chunk = chunks[item.index];
        if (chunk) {
          // Get OpenAI-extracted keywords
          const aiKeywords = item.keywords || [];

          // Extract keywords from document taxonomy
          const taxonomyKeywords = this.extractKeywordsFromTaxonomy(
            chunk.documentTaxonomy
          );

          // Merge: taxonomy keywords first (document-level), then AI keywords (chunk-specific)
          const allKeywords = [...new Set([...taxonomyKeywords, ...aiKeywords])];

          results.set(chunk.id, allKeywords);
        }
      });

      return results;
    } catch (error) {
      console.error("Error extracting keywords:", error);
      // Fallback: return collection name + taxonomy keywords
      const fallback = new Map<string, string[]>();
      chunks.forEach((chunk) => {
        const taxonomyKeywords = this.extractKeywordsFromTaxonomy(
          chunk.documentTaxonomy
        );
        const fallbackKeywords = [collectionName, ...taxonomyKeywords];
        fallback.set(chunk.id, [...new Set(fallbackKeywords)]);
      });
      return fallback;
    }
  }
}
