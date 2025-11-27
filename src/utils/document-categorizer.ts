import OpenAI from "openai";
import { PostgresService } from "../storage";
import { parseJsonFromLLM } from "./json-parser";

/**
 * Document Categorization Result
 */
export interface CategorizationResult {
  collectionId: string;
  collectionName: string;
  isNewCollection: boolean;
  confidence: number; // 0-100
  reasoning: string;
}

/**
 * Document Categorizer
 *
 * AI-powered document categorization using OpenAI GPT-4o-mini.
 * Analyzes document content and suggests appropriate collection,
 * considering existing collections and content similarity.
 */
export class DocumentCategorizer {
  private openai: OpenAI;

  constructor(
    private storageService: PostgresService,
    openaiApiKey?: string
  ) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Categorize document into appropriate collection
   *
   * Analyzes document content and suggests which collection it belongs to.
   * If no existing collection is appropriate, suggests creating a new one.
   */
  async categorizeDocument(document: {
    title: string;
    content: string;
    fileName: string;
  }): Promise<CategorizationResult> {
    // Get existing collections from database
    const collectionsResult = await this.storageService.query(
      `SELECT id, name, description, taxonomy
       FROM document_collections
       ORDER BY created_at DESC`
    );

    const existingCollections = collectionsResult.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || "No description",
      taxonomy: row.taxonomy,
    }));

    // Build prompt for Claude
    const prompt = this.buildCategorizationPrompt(
      document,
      existingCollections
    );

    // Call OpenAI GPT-4o-mini for categorization
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 800,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.choices[0]?.message?.content || "";

    // Parse response
    let result: CategorizationResult;
    try {
      const parsed = parseJsonFromLLM(responseText);
      result = this.validateCategorizationResult(parsed);
    } catch (error) {
      console.error("Failed to parse categorization response:", responseText);
      // Fallback: create "uncategorized" collection
      return this.getFallbackCategorization();
    }

    return result;
  }

  /**
   * Build categorization prompt for Claude
   */
  private buildCategorizationPrompt(
    document: { title: string; content: string; fileName: string },
    existingCollections: Array<{
      id: string;
      name: string;
      description: string;
      taxonomy: any;
    }>
  ): string {
    const collectionsInfo =
      existingCollections.length > 0
        ? existingCollections
            .map(
              (c) =>
                `- **${c.name}** (id: ${c.id}): ${c.description}${
                  c.taxonomy?.topics
                    ? "\n  Topics: " + c.taxonomy.topics.join(", ")
                    : ""
                }`
            )
            .join("\n")
        : "No existing collections yet.";

    // Take first 3000 characters of content for analysis
    const contentPreview = document.content.substring(0, 3000);

    return `I am analyzing a document to determine which collection it belongs to.

DOCUMENT INFORMATION:
- Title: ${document.title}
- File Name: ${document.fileName}
- Content Preview (first 3000 chars):
${contentPreview}

EXISTING COLLECTIONS:
${collectionsInfo}

TASK:
Determine the best collection for this document. Consider:
1. Content similarity with existing collections
2. Topic alignment
3. Whether creating a new collection would be more appropriate

RULES:
- If document clearly belongs to an existing collection, suggest that collection
- If document represents a new topic/domain, suggest creating a new collection
- New collection names should be descriptive, lowercase, hyphen-separated (e.g., "climate-research", "financial-reports")
- Confidence should be 0-100 (higher means more confident)

Return JSON:
{
  "collectionId": "existing-collection-id OR new-collection-id",
  "collectionName": "Human readable name",
  "isNewCollection": true/false,
  "confidence": 85,
  "reasoning": "Why this document belongs in this collection"
}`;
  }

  /**
   * Validate and normalize categorization result
   */
  private validateCategorizationResult(parsed: any): CategorizationResult {
    if (
      !parsed ||
      !parsed.collectionId ||
      !parsed.collectionName ||
      typeof parsed.isNewCollection !== "boolean" ||
      typeof parsed.confidence !== "number" ||
      !parsed.reasoning
    ) {
      throw new Error("Invalid categorization result structure");
    }

    return {
      collectionId: String(parsed.collectionId).toLowerCase().replace(/\s+/g, "-"),
      collectionName: String(parsed.collectionName),
      isNewCollection: Boolean(parsed.isNewCollection),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence))),
      reasoning: String(parsed.reasoning),
    };
  }

  /**
   * Get fallback categorization when AI fails
   */
  private getFallbackCategorization(): CategorizationResult {
    return {
      collectionId: "uncategorized",
      collectionName: "Uncategorized",
      isNewCollection: true,
      confidence: 50,
      reasoning: "Failed to categorize document automatically. Placed in 'uncategorized' collection.",
    };
  }

  /**
   * Create new collection in database
   */
  async createCollection(collectionId: string, collectionName: string): Promise<void> {
    await this.storageService.query(
      `INSERT INTO document_collections (id, name, description, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        collectionId,
        collectionName,
        `Auto-created collection for ${collectionName}`,
      ]
    );
  }
}
