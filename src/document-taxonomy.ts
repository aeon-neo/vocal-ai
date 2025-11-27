import OpenAI from "openai";

/**
 * Document Taxonomy - AI-powered metadata extraction
 *
 * Analyzes individual documents to extract:
 * - Critical metadata (publication date, author, source URL)
 * - Document taxonomy (type, topics, entities, summary, tags)
 *
 * This provides richer metadata than statistical keyword extraction alone,
 * enabling document-type filtering and improved search relevance.
 */

export interface DocumentTaxonomy {
  // Critical metadata (extracted from document content)
  publicationDate?: string; // ISO date string or "unknown"
  author?: string; // Organization, department, or individual author
  sourceUrl?: string; // Original web source if identifiable

  // Document taxonomy
  documentType: string; // legislation, guidance, news, policy, FAQ, analysis, court decision, form, template
  mainTopics: string[]; // 3-5 key topics specific to this document
  keyEntities: string[]; // Organizations, people, locations, legislation sections
  summary: string; // 2-3 sentence overview
  tags: string[]; // 5-10 actionable tags

  // Metadata
  confidence: "high" | "medium" | "low"; // AI confidence in extraction
  generatedAt: string; // ISO timestamp
}

export interface DocumentToAnalyze {
  id: string;
  title: string;
  content: string; // Full document text
  fileName: string;
}

export class DocumentAnalyzer {
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
   * Split document into chunks of approximately equal size
   */
  private splitIntoChunks(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Analyze a single document and extract comprehensive taxonomy
   */
  async analyzeDocument(document: DocumentToAnalyze): Promise<DocumentTaxonomy> {
    console.log(`  Analyzing: ${document.title}`);

    // Split document into chunks for analysis
    // Extract first and last 12 chunks to capture metadata at both ends
    // Important metadata is often at:
    // - Beginning: Title, author headers, introduction, publication info
    // - End: Publication date, copyright, version numbers, final amendments
    const chunks = this.splitIntoChunks(document.content, 1000); // ~1000 chars per chunk

    const firstChunks = chunks.slice(0, 12); // First 12 chunks (~12,000 chars)
    const lastChunks = chunks.length > 24
      ? chunks.slice(-12) // Last 12 chunks (~12,000 chars)
      : []; // Don't duplicate if document is small

    const contentSample = lastChunks.length > 0
      ? `${firstChunks.join('\n\n')}\n\n[... middle content omitted ...]\n\n${lastChunks.join('\n\n')}`
      : firstChunks.join('\n\n');

    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    const prompt = `CURRENT DATE: ${currentDate}

Analyze this document and extract comprehensive metadata and taxonomy.

## Document Information:
**Title:** ${document.title}
**Filename:** ${document.fileName}

## Document Content (first 12 chunks + last 12 chunks, ~24,000 characters total):
${contentSample}

## Task:
Extract the following information from this document. Be as accurate as possible. If information cannot be found, use null or "unknown".

Respond in this exact JSON format:

{
  "publicationDate": "YYYY-MM-DD or null if not found",
  "author": "Author/publisher name or null",
  "sourceUrl": "Original URL if mentioned in document or null",
  "documentType": "One of: legislation, guidance, news, policy, FAQ, analysis, court-decision, form, template, other",
  "mainTopics": ["3-5 key topics specific to this document"],
  "keyEntities": ["Organizations, people, locations, legislation sections mentioned"],
  "summary": "2-3 sentence overview of document purpose and scope",
  "tags": ["5-10 actionable tags like registration-deadline, evidence-requirements, etc"],
  "confidence": "high, medium, or low"
}

**Instructions:**
1. **publicationDate**: Look for dates in multiple places:
   - Headers/footers: "Published on [date]", "Date: [date]"
   - First page: Publication info, version numbers
   - **Last page**: "Ordered to be Printed, [date]", copyright dates, "... [year]"
   - Format as YYYY-MM-DD (convert month names to numbers)
2. **author**: Look for:
   - Organizational authors: "Department for Education", "House of Commons", "Parliamentary copyright"
   - Individual authors in headers or signature sections
   - Publisher information
3. **sourceUrl**: Check if document mentions its original web source (e.g., "Downloaded from https://...", "Available at www...").
4. **documentType**: Classify based on purpose and format.
5. **mainTopics**: Be specific (e.g., "CWSB registration procedures" not just "registration").
   FOR CURRICULUM DOCUMENTS: Include BOTH key stage AND year group equivalents:
   - If document is about "Key Stage 4" -> mainTopics should include "Key Stage 4 / Years 10-11"
   - If document is about "Key Stage 3" -> mainTopics should include "Key Stage 3 / Years 7-9"
   - If document mentions "GCSE" -> mainTopics should include "GCSE / Year 11"
6. **keyEntities**: Include prominent organizations, people, legislation sections (e.g., "Section 12", "Department for Education").
7. **summary**: Focus on what compliance information this document provides.
8. **tags**: Use hyphenated format (e.g., "evidence-requirements", "school-attendance-order").
   FOR CURRICULUM DOCUMENTS: Include year group tags alongside key stage tags:
   - Document about Key Stage 4 -> tags should include both "key-stage-4" AND "year-10" AND "year-11" AND "gcse"
   - Document about Key Stage 3 -> tags should include both "key-stage-3" AND "year-7" AND "year-8" AND "year-9"
9. **confidence**: High if metadata clearly stated, medium if inferred, low if guessing.

**Important**: The document content includes both the BEGINNING and END of the document. Check the end carefully for publication dates and copyright info.

Return ONLY the JSON object, no additional text.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1000,
        temperature: 0, // Maximum accuracy for metadata extraction
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";

      // Strip markdown code fences if present
      let jsonText = content.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7); // Remove ```json
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3); // Remove ```
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3); // Remove trailing ```
      }
      jsonText = jsonText.trim();

      const taxonomy = JSON.parse(jsonText);

      // Add generation timestamp
      taxonomy.generatedAt = new Date().toISOString();

      return taxonomy;
    } catch (error) {
      console.warn(`  Failed to analyze ${document.title}:`, error);

      // Return fallback taxonomy with basic information
      return {
        documentType: "other",
        mainTopics: [document.title],
        keyEntities: [],
        summary: `Document: ${document.title}`,
        tags: ["unclassified"],
        confidence: "low",
        generatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Analyze multiple documents in batch (with progress tracking)
   */
  async analyzeDocuments(
    documents: DocumentToAnalyze[],
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, DocumentTaxonomy>> {
    console.log(`\nAnalyzing ${documents.length} documents with AI...`);

    const taxonomies = new Map<string, DocumentTaxonomy>();

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const taxonomy = await this.analyzeDocument(doc);
      taxonomies.set(doc.id, taxonomy);

      if (onProgress) {
        onProgress(i + 1, documents.length);
      }

      // Rate limiting: Add small delay between requests
      if (i < documents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between requests
      }
    }

    console.log(`\nCompleted analysis of ${documents.length} documents`);
    return taxonomies;
  }

  /**
   * Generate a summary report of document taxonomy analysis
   */
  generateAnalysisReport(taxonomies: Map<string, DocumentTaxonomy>): string {
    const taxonomyArray = Array.from(taxonomies.values());

    // Count document types
    const typeCount = new Map<string, number>();
    taxonomyArray.forEach(tax => {
      typeCount.set(tax.documentType, (typeCount.get(tax.documentType) || 0) + 1);
    });

    // Collect all unique topics
    const allTopics = new Set<string>();
    taxonomyArray.forEach(tax => {
      tax.mainTopics.forEach(topic => allTopics.add(topic));
    });

    // Collect all unique tags
    const allTags = new Set<string>();
    taxonomyArray.forEach(tax => {
      tax.tags.forEach(tag => allTags.add(tag));
    });

    // Count confidence levels
    const highConfidence = taxonomyArray.filter(t => t.confidence === "high").length;
    const mediumConfidence = taxonomyArray.filter(t => t.confidence === "medium").length;
    const lowConfidence = taxonomyArray.filter(t => t.confidence === "low").length;

    return `
# Document Taxonomy Analysis Report

**Total Documents Analyzed:** ${taxonomies.size}
**Generated:** ${new Date().toLocaleString()}

## Document Type Distribution

${Array.from(typeCount.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([type, count]) => `- ${type}: ${count} (${Math.round(count / taxonomies.size * 100)}%)`)
  .join("\n")}

## Metadata Extraction Confidence

- High confidence: ${highConfidence} (${Math.round(highConfidence / taxonomies.size * 100)}%)
- Medium confidence: ${mediumConfidence} (${Math.round(mediumConfidence / taxonomies.size * 100)}%)
- Low confidence: ${lowConfidence} (${Math.round(lowConfidence / taxonomies.size * 100)}%)

## Unique Topics Identified

Total unique topics: ${allTopics.size}

${Array.from(allTopics).sort().slice(0, 20).map(topic => `- ${topic}`).join("\n")}
${allTopics.size > 20 ? `\n... and ${allTopics.size - 20} more` : ""}

## Unique Tags Generated

Total unique tags: ${allTags.size}

${Array.from(allTags).sort().slice(0, 30).map(tag => `- ${tag}`).join("\n")}
${allTags.size > 30 ? `\n... and ${allTags.size - 30} more` : ""}

## Documents with Extracted Metadata

**Publication Dates:** ${taxonomyArray.filter(t => t.publicationDate && t.publicationDate !== "unknown").length} documents
**Authors:** ${taxonomyArray.filter(t => t.author).length} documents
**Source URLs:** ${taxonomyArray.filter(t => t.sourceUrl).length} documents

---

*This report was generated automatically using AI document analysis (OpenAI GPT-4o-mini).*
`;
  }
}
