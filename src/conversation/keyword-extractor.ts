/**
 * Conversation Keyword Extractor
 *
 * Extracts semantic and emotional keywords from conversation messages
 * for hybrid search and context retrieval.
 *
 * Similar to chunk-keyword-extractor.ts but optimized for conversational content.
 */

import OpenAI from "openai";

export interface ConversationKeywords {
  messageId: number;
  keywords: string[];
}

export class ConversationKeywordExtractor {
  private openai: OpenAI;

  constructor(openaiApiKey?: string) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Extract keywords from multiple conversation messages in batch
   * Processes up to 10 messages per API call for efficiency
   */
  async extractKeywordsForMessages(
    messages: Array<{
      id: number;
      role: string;
      content: string;
      createdAt: Date;
    }>
  ): Promise<ConversationKeywords[]> {
    if (messages.length === 0) {
      return [];
    }

    const batchSize = 10;
    const results: ConversationKeywords[] = [];

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const batchResults = await this.processBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async processBatch(
    messages: Array<{
      id: number;
      role: string;
      content: string;
      createdAt: Date;
    }>
  ): Promise<ConversationKeywords[]> {
    const messagesJson = messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content.substring(0, 2000), // Limit length for API efficiency
    }));

    const prompt = `Extract 3-8 semantic and emotional keywords from each conversation message.

Focus on:
- Key topics and subjects discussed
- Named entities (people, places, organizations)
- Emotional tone (frustrated, excited, curious, concerned, etc.)
- Actions mentioned (planning, implementing, debugging, etc.)
- Important concepts and terms
- Contact information markers (email, phone, address mentioned)

Return ONLY a JSON array with this structure:
[
  {
    "id": 123,
    "keywords": ["keyword1", "keyword2", "keyword3"]
  }
]

Messages to analyze:
${JSON.stringify(messagesJson, null, 2)}

Return JSON only, no commentary.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt + "\n\nRespond with a JSON object containing a 'results' array.",
          },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      const results = parsed.results || [];

      // Parse JSON response
      const jsonMatch = JSON.stringify(results).match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("[ConversationKeywordExtractor] No JSON array found in response");
        return [];
      }

      const extracted = JSON.parse(jsonMatch[0]) as Array<{
        id: number;
        keywords: string[];
      }>;

      return extracted.map((item) => ({
        messageId: item.id,
        keywords: item.keywords || [],
      }));
    } catch (error) {
      console.error("[ConversationKeywordExtractor] Error extracting keywords:", error);
      return [];
    }
  }

  /**
   * Extract keywords from a single message (for real-time processing)
   */
  async extractKeywordsForMessage(message: {
    id: number;
    role: string;
    content: string;
  }): Promise<string[]> {
    const results = await this.extractKeywordsForMessages([
      {
        ...message,
        createdAt: new Date(),
      },
    ]);

    return results.length > 0 ? results[0].keywords : [];
  }
}
