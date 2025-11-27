import OpenAI from "openai";

/**
 * Query Keyword Extractor - AI-powered query term extraction
 *
 * Uses OpenAI GPT-4o-mini to extract meaningful search terms from natural language queries,
 * filtering out stop words, articles, and non-content words.
 *
 * This ensures we search with the SAME quality keywords that were used during
 * chunk indexing, rather than naive tokenization that includes "what", "are", "the", etc.
 */

export class QueryKeywordExtractor {
  private openai: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Extract meaningful search keywords from a natural language query
   *
   * Returns 3-8 semantic keywords, filtering out stop words and articles
   */
  async extractKeywords(query: string): Promise<string[]> {
    const prompt = `Extract 3-12 meaningful search keywords from this query, including relevant synonyms and UK education system equivalents.

Query: "${query}"

Rules:
- Extract only CONTENT words (nouns, verbs, adjectives, proper nouns)
- Exclude stop words: what, are, the, is, of, to, in, for, on, at, how, etc.
- Exclude articles: a, an, the
- Use lowercase
- Multi-word phrases are OK if they're meaningful (e.g., "home education", "children's wellbeing bill")
- Focus on terms that would appear in relevant documents

UK EDUCATION EQUIVALENTS (CRITICAL):
If query mentions year groups or key stages, INCLUDE ALL EQUIVALENT TERMS:
- "year 11" or "year eleven" → ALSO include: "key stage 4", "ks4", "gcse"
- "year 10" → ALSO include: "key stage 4", "ks4"
- "year 9" or "year nine" → ALSO include: "key stage 3", "ks3"
- "year 8" → ALSO include: "key stage 3", "ks3"
- "year 7" → ALSO include: "key stage 3", "ks3"
- "key stage 4" or "ks4" → ALSO include: "year 10", "year 11", "gcse"
- "key stage 3" or "ks3" → ALSO include: "year 7", "year 8", "year 9"
- "gcse" → ALSO include: "key stage 4", "ks4", "year 11"
- "maths" → ALSO include: "mathematics"
- "science" → ALSO include: "sciences"

Return ONLY a JSON array of keywords, no other text.

Examples:

Query: "What are the registration requirements for home education under CWSB?"
Response: ["registration requirements", "home education", "cwsb", "children's wellbeing bill"]

Query: "How do I appeal a School Attendance Order?"
Response: ["appeal", "school attendance order", "sao", "legal process"]

Query: "What is year 11 maths curriculum?"
Response: ["year 11", "year eleven", "key stage 4", "ks4", "gcse", "maths", "mathematics", "curriculum"]

Query: "What topics are in KS3 science?"
Response: ["key stage 3", "ks3", "year 7", "year 8", "year 9", "science", "sciences", "topics", "curriculum"]

Now extract keywords from the query above:`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 500,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt + "\n\nRespond with a JSON object containing a 'keywords' array.",
          },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";

      // Extract JSON from response (handle markdown code blocks)
      let jsonText = content.trim();
      if (jsonText.includes("```")) {
        const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1].trim();
        }
      }

      const parsed = JSON.parse(jsonText);
      const keywords: string[] = parsed.keywords || parsed;

      // Validate and normalize
      const normalized = keywords
        .map((k: string) => k.toLowerCase().trim())
        .filter((k: string) => k.length > 0);

      console.log(`Query keywords extracted: [${normalized.join(', ')}]`);
      return normalized;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Query keyword extraction failed:", errorMessage);
      console.error("Full error:", error);

      // Fallback: simple tokenization (remove very common stop words)
      const stopWords = new Set([
        'what', 'are', 'the', 'is', 'of', 'to', 'in', 'for', 'on', 'at',
        'how', 'do', 'does', 'can', 'will', 'would', 'should', 'a', 'an',
        'and', 'or', 'but', 'as', 'with', 'from', 'by', 'this', 'that',
        'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our'
      ]);

      const fallbackKeywords = query
        .toLowerCase()
        .replace(/[^\w\s'-]/g, " ")
        .split(/\s+/)
        .filter(term => term.length > 2 && !stopWords.has(term));

      console.warn(`Using fallback tokenization: [${fallbackKeywords.join(', ')}]`);
      return fallbackKeywords;
    }
  }
}
