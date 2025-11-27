/**
 * Conversation Entity Extractor
 *
 * Extracts entities (people, organizations, emails, etc.) from conversation messages
 * for knowledge graph construction and hybrid search.
 *
 * Optimized for conversational content with focus on:
 * - Contact information (emails, phone numbers)
 * - Person names mentioned in context
 * - Organizations and companies
 * - Dates and events
 */

import OpenAI from "openai";
import crypto from "crypto";

export interface ConversationEntity {
  entityId: string; // MD5 hash of normalized entity name
  entityName: string; // Human-readable entity name
  entityType: string; // Person, Organization, Email, Phone, Date, Location, etc.
  description: string; // Brief description/context
  sourceMessageId: number; // Message ID where entity was found
  confidence: number; // 0-1 confidence score
  metadata?: Record<string, any>; // Additional context (email address, phone number, etc.)
}

export interface ConversationEntityExtractionResult {
  messageId: number;
  entities: ConversationEntity[];
}

export class ConversationEntityExtractor {
  private openai: OpenAI;

  constructor(openaiApiKey?: string) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate MD5 hash of normalized entity name for deduplication
   */
  private generateEntityId(entityName: string): string {
    const normalized = entityName.toLowerCase().trim().replace(/\s+/g, " ");
    return crypto.createHash("md5").update(normalized).digest("hex");
  }

  /**
   * Extract entities from multiple conversation messages in batch
   * Processes up to 5 messages per API call
   */
  async extractEntitiesForMessages(
    messages: Array<{
      id: number;
      role: string;
      content: string;
      createdAt: Date;
    }>
  ): Promise<ConversationEntityExtractionResult[]> {
    if (messages.length === 0) {
      return [];
    }

    const batchSize = 5;
    const results: ConversationEntityExtractionResult[] = [];

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
  ): Promise<ConversationEntityExtractionResult[]> {
    const messagesJson = messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content.substring(0, 2000),
    }));

    const prompt = `Extract entities from each conversation message. Focus on conversational context.

Entity types to extract:
- **Person**: People mentioned by name (e.g., "Kent Denmark", "Joel Smalley")
- **Organization**: Companies, institutions (e.g., "Anthropic", "OpenAI")
- **Email**: Email addresses (extract the actual address)
- **Phone**: Phone numbers
- **Location**: Places, addresses, cities, countries
- **Date**: Specific dates or time references
- **Event**: Named events, meetings, conferences
- **Concept**: Important topics or ideas discussed

For each entity, provide:
- entityName: The actual name/value
- entityType: One of the types above
- description: Brief context about how it was mentioned
- confidence: 0.0-1.0 score
- metadata: Additional info (e.g., {"email": "kent@example.com"} for Person with email)

Return ONLY a JSON array:
[
  {
    "messageId": 123,
    "entities": [
      {
        "entityName": "Kent Denmark",
        "entityType": "Person",
        "description": "Person mentioned in context of waitlist",
        "confidence": 1.0,
        "metadata": {"email": "kent@example.com"}
      }
    ]
  }
]

IMPORTANT: Extract email addresses as both:
1. A Person entity with email in metadata
2. An Email entity with the address as entityName

Messages to analyze:
${JSON.stringify(messagesJson, null, 2)}

Return JSON only, no commentary.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4000,
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
        console.error("[ConversationEntityExtractor] No JSON array found in response");
        return [];
      }

      const extracted = JSON.parse(jsonMatch[0]) as Array<{
        messageId: number;
        entities: Array<{
          entityName: string;
          entityType: string;
          description: string;
          confidence: number;
          metadata?: Record<string, any>;
        }>;
      }>;

      // Generate entity IDs and map to our interface
      return extracted.map((item) => ({
        messageId: item.messageId,
        entities: item.entities.map((entity) => ({
          entityId: this.generateEntityId(entity.entityName),
          entityName: entity.entityName,
          entityType: entity.entityType,
          description: entity.description,
          sourceMessageId: item.messageId,
          confidence: entity.confidence || 0.8,
          metadata: entity.metadata || {},
        })),
      }));
    } catch (error) {
      console.error("[ConversationEntityExtractor] Error extracting entities:", error);
      return [];
    }
  }

  /**
   * Extract entities from a single message (for real-time processing)
   */
  async extractEntitiesForMessage(message: {
    id: number;
    role: string;
    content: string;
  }): Promise<ConversationEntity[]> {
    const results = await this.extractEntitiesForMessages([
      {
        ...message,
        createdAt: new Date(),
      },
    ]);

    return results.length > 0 ? results[0].entities : [];
  }
}
