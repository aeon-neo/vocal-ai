import OpenAI from "openai";
import { PostgresService } from "./storage";

export interface CollectionTaxonomy {
  overview: string;
  primaryTopics: string[];
  secondaryTopics: string[];
  keyThemes: string[];
  targetAudience: string[];
  contentTypes: string[];
  suggestedQueries: {
    semantic: string[];
    technical: string[];
    exploratory: string[];
  };
  metadata: {
    totalDocuments: number;
    topKeywords: string[];
    generatedAt: string;
    collectionName: string;
  };
}

export interface DocumentSample {
  title: string;
  content: string;
  url?: string;
  keywords: string[];
}

export interface DocumentTaxonomySample {
  title: string;
  taxonomy: {
    mainTopics: string[];
    tags: string[];
    keyEntities: string[];
    summary: string;
    documentType?: string;
    author?: string;
    publicationDate?: string;
  };
}

export class CollectionAnalyzer {
  private openai: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  private analyzeDocumentTaxonomies(documents: DocumentTaxonomySample[]): {
    allTopics: string[];
    allTags: string[];
    allEntities: string[];
    allSummaries: string[];
    topicFrequency: Map<string, number>;
    tagFrequency: Map<string, number>;
    entityFrequency: Map<string, number>;
  } {
    const topicFreq = new Map<string, number>();
    const tagFreq = new Map<string, number>();
    const entityFreq = new Map<string, number>();
    const allSummaries: string[] = [];

    documents.forEach((doc) => {
      // Aggregate main topics
      doc.taxonomy.mainTopics?.forEach((topic) => {
        topicFreq.set(topic, (topicFreq.get(topic) || 0) + 1);
      });

      // Aggregate tags
      doc.taxonomy.tags?.forEach((tag) => {
        tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
      });

      // Aggregate entities
      doc.taxonomy.keyEntities?.forEach((entity) => {
        entityFreq.set(entity, (entityFreq.get(entity) || 0) + 1);
      });

      // Collect summaries
      if (doc.taxonomy.summary) {
        allSummaries.push(`${doc.title}: ${doc.taxonomy.summary}`);
      }
    });

    // Sort by frequency
    const sortedTopics = Array.from(topicFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([topic]) => topic);

    const sortedTags = Array.from(tagFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    const sortedEntities = Array.from(entityFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([entity]) => entity);

    return {
      allTopics: sortedTopics,
      allTags: sortedTags,
      allEntities: sortedEntities,
      allSummaries,
      topicFrequency: topicFreq,
      tagFrequency: tagFreq,
      entityFrequency: entityFreq,
    };
  }

  private async analyzeCorpus(documents: DocumentSample[]): Promise<{
    topKeywords: string[];
    keywordFrequency: Map<string, number>;
    contentSample: string;
  }> {
    // Collect all AI-generated keywords with frequencies
    const keywordFreq = new Map<string, number>();

    documents.forEach((doc) => {
      doc.keywords.forEach((keyword) => {
        keywordFreq.set(keyword, (keywordFreq.get(keyword) || 0) + 1);
      });
    });

    // Sort by frequency
    const topKeywords = Array.from(keywordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword);

    // Create representative content sample for AI analysis
    const contentSample = documents
      .slice(0, 5)
      .map(
        (doc) =>
          `Title: ${doc.title}\nContent: ${doc.content.substring(0, 500)}...`
      )
      .join("\n\n---\n\n");

    return {
      topKeywords,
      keywordFrequency: keywordFreq,
      contentSample,
    };
  }

  private async generateAIInsightsFromTaxonomies(
    documentTaxonomies: DocumentTaxonomySample[],
    taxonomyAnalysis: {
      allTopics: string[];
      allTags: string[];
      allEntities: string[];
      allSummaries: string[];
    }
  ): Promise<{
    overview: string;
    primaryTopics: string[];
    secondaryTopics: string[];
    keyThemes: string[];
    targetAudience: string[];
    contentTypes: string[];
  }> {
    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    // Create summary sample (up to 10 document summaries)
    const summariesSample = taxonomyAnalysis.allSummaries.slice(0, 10).join("\n\n");

    const prompt = `CURRENT DATE: ${currentDate}

Analyze this document collection based on AI-generated document taxonomies and provide comprehensive collection-level insights.

## Document Count: ${documentTaxonomies.length} documents

## Top Topics Across ALL Documents (by frequency):
${taxonomyAnalysis.allTopics.slice(0, 30).join(", ")}

## Top Tags Across ALL Documents (by frequency):
${taxonomyAnalysis.allTags.slice(0, 30).join(", ")}

## Key Entities Mentioned:
${taxonomyAnalysis.allEntities.slice(0, 20).join(", ")}

## Sample Document Summaries:
${summariesSample}

## All Document Titles:
${documentTaxonomies.map((doc) => `- ${doc.title}`).join("\n")}

Please provide analysis in this exact JSON format:

{
  "overview": "2-3 sentence overview of what this collection covers",
  "primaryTopics": ["5-7 main topics covered"],
  "secondaryTopics": ["5-7 supporting or related topics"],
  "keyThemes": ["5-7 key themes or recurring concepts"],
  "targetAudience": ["3-5 types of people who would find this valuable"],
  "contentTypes": ["3-5 types of content formats or styles present"]
}

Focus on being specific and actionable. Consider ALL ${documentTaxonomies.length} documents in the collection when generating insights. Use the frequency of topics/tags to identify the most important themes.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1000,
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
        jsonText = jsonText.slice(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      const insights = JSON.parse(jsonText);
      return insights;
    } catch (error) {
      console.error("AI analysis failed:", error);
      throw error;
    }
  }

  private async generateAIInsights(
    documents: DocumentSample[],
    corpusAnalysis: { topKeywords: string[]; contentSample: string }
  ): Promise<{
    overview: string;
    primaryTopics: string[];
    secondaryTopics: string[];
    keyThemes: string[];
    targetAudience: string[];
    contentTypes: string[];
  }> {
    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    const prompt = `CURRENT DATE: ${currentDate}

Analyze this document collection and provide comprehensive insights.

## Collection Sample Content:
${corpusAnalysis.contentSample}

## Top Keywords Across Collection:
${corpusAnalysis.topKeywords.slice(0, 30).join(", ")}

## Document Titles:
${documents
        .slice(0, 10)
        .map((doc) => `- ${doc.title}`)
        .join("\n")}

Please provide analysis in this exact JSON format:

{
  "overview": "2-3 sentence overview of what this collection covers",
  "primaryTopics": ["5-7 main topics covered"],
  "secondaryTopics": ["5-7 supporting or related topics"],
  "keyThemes": ["5-7 key themes or recurring concepts"],
  "targetAudience": ["3-5 types of people who would find this valuable"],
  "contentTypes": ["3-5 types of content formats or styles present"]
}

Focus on being specific and actionable. Consider the keywords and content themes to identify what makes this collection unique and valuable.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1000,
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
        jsonText = jsonText.slice(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      const insights = JSON.parse(jsonText);
      return insights;
    } catch (error) {
      console.error("AI analysis failed:", error);
      throw error;
    }
  }

  private async generateSuggestedQueriesFromTaxonomies(
    documentTaxonomies: DocumentTaxonomySample[],
    taxonomyAnalysis: { allTopics: string[]; allTags: string[] },
    insights: { primaryTopics: string[]; keyThemes: string[] }
  ): Promise<{
    semantic: string[];
    technical: string[];
    exploratory: string[];
  }> {
    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    const prompt = `CURRENT DATE: ${currentDate}

Based on this document collection analysis (${documentTaxonomies.length} documents), generate relevant search queries that users might want to try.

## Collection Overview:
- Primary Topics: ${insights.primaryTopics.join(", ")}
- Key Themes: ${insights.keyThemes.join(", ")}
- Top Topics (by frequency): ${taxonomyAnalysis.allTopics.slice(0, 15).join(", ")}
- Top Tags (by frequency): ${taxonomyAnalysis.allTags.slice(0, 15).join(", ")}

## Document Titles:
${documentTaxonomies
        .slice(0, 10)
        .map((doc) => `- ${doc.title}`)
        .join("\n")}

Generate 15 search queries (5 in each category) that would be relevant for this collection:

**Semantic Queries** - Conceptual questions about topics and themes
**Technical Queries** - Specific terms, processes, or implementations
**Exploratory Queries** - Broad discovery questions to explore the collection

Respond in this exact JSON format:

{
  "semantic": [
    "5 conceptual questions about the topics covered"
  ],
  "technical": [
    "5 specific technical or process-oriented queries"
  ],
  "exploratory": [
    "5 broad exploration questions to discover content"
  ]
}

Make queries natural and specific to this collection's content. Each query should be something a real user would search for.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";
      // Extract JSON from response (handles markdown fences and extra text)
      let text = content.trim();

      // Strip markdown code fences if present
      if (text.startsWith('```json')) {
        text = text.slice(7);
      } else if (text.startsWith('```')) {
        text = text.slice(3);
      }
      if (text.endsWith('```')) {
        text = text.slice(0, -3);
      }
      text = text.trim();

      // Extract JSON object (find first { and matching })
      const firstBrace = text.indexOf('{');
      if (firstBrace === -1) {
        throw new Error("No JSON object found in response");
      }

      // Find matching closing brace
      let braceCount = 0;
      let lastBrace = -1;
      for (let i = firstBrace; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        if (text[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            lastBrace = i;
            break;
          }
        }
      }

      if (lastBrace === -1) {
        throw new Error("No closing brace found for JSON object");
      }

      const jsonText = text.slice(firstBrace, lastBrace + 1);
      const queries = JSON.parse(jsonText);
      return queries;
    } catch (error) {
      console.error("Query generation failed:", error);
      throw error;
    }
  }

  private async generateSuggestedQueries(
    documents: DocumentSample[],
    corpusAnalysis: { topKeywords: string[] },
    insights: { primaryTopics: string[]; keyThemes: string[] }
  ): Promise<{
    semantic: string[];
    technical: string[];
    exploratory: string[];
  }> {
    const currentDate = new Date().toLocaleString('en-GB', {
      dateStyle: 'full',
      timeZone: 'Europe/London'
    });

    const prompt = `CURRENT DATE: ${currentDate}

Based on this document collection analysis, generate relevant search queries that users might want to try.

## Collection Overview:
- Primary Topics: ${insights.primaryTopics.join(", ")}
- Key Themes: ${insights.keyThemes.join(", ")}
- Top Keywords: ${corpusAnalysis.topKeywords.slice(0, 15).join(", ")}

## Sample Titles:
${documents
        .slice(0, 8)
        .map((doc) => `- ${doc.title}`)
        .join("\n")}

Generate 15 search queries (5 in each category) that would be relevant for this collection:

**Semantic Queries** - Conceptual questions about topics and themes
**Technical Queries** - Specific terms, processes, or implementations
**Exploratory Queries** - Broad discovery questions to explore the collection

Respond in this exact JSON format:

{
  "semantic": [
    "5 conceptual questions about the topics covered"
  ],
  "technical": [
    "5 specific technical or process-oriented queries"
  ],
  "exploratory": [
    "5 broad exploration questions to discover content"
  ]
}

Make queries natural and specific to this collection's content. Each query should be something a real user would search for.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 800,
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
        jsonText = jsonText.slice(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      const queries = JSON.parse(jsonText);
      return queries;
    } catch (error) {
      console.error("Query generation failed:", error);
      throw error;
    }
  }

  private async loadAllDocumentTaxonomies(
    storageService: PostgresService,
    collectionId: string
  ): Promise<DocumentTaxonomySample[]> {
    // Load ALL document taxonomies from knowledge_documents table
    // This ensures collection taxonomy is based on complete document set, not just recent additions
    try {
      const query = `
        SELECT title, ai_taxonomy
        FROM knowledge_documents
        WHERE collection_id = $1 AND ai_taxonomy IS NOT NULL
        ORDER BY title
      `;

      const result = await storageService.query(query, [collectionId]);
      const documents = result.rows || [];

      if (documents.length === 0) {
        throw new Error(`No documents with taxonomies found in collection: ${collectionId}`);
      }

      return documents.map((doc: any) => ({
        title: doc.title,
        taxonomy: doc.ai_taxonomy,
      }));
    } catch (error) {
      console.error(`Error loading document taxonomies for ${collectionId}:`, error);
      throw error;
    }
  }

  private async sampleDocuments(
    storageService: PostgresService,
    tableName: string,
    collectionId: string | null,
    maxSamples: number
  ): Promise<DocumentSample[]> {
    // Get all vectors with AI-generated keywords from the collection
    try {
      const query = collectionId
        ? `
      SELECT id, content, metadata, keywords
      FROM ${tableName}
      WHERE collection_id = $1
      ORDER BY created_at DESC
      LIMIT 1000
    `
        : `
      SELECT id, content, metadata, keywords
      FROM ${tableName}
      ORDER BY created_at DESC
      LIMIT 1000
    `;

      const result = collectionId
        ? await storageService.query(query, [collectionId])
        : await storageService.query(query);
      const allVectors = result.rows || [];

      if (allVectors.length === 0) {
        return [];
      }

      // Sample documents evenly or take all if under limit
      const sampleSize = Math.min(maxSamples, allVectors.length);
      const step =
        allVectors.length > maxSamples
          ? Math.floor(allVectors.length / maxSamples)
          : 1;

      const samples: DocumentSample[] = [];

      for (
        let i = 0;
        i < allVectors.length && samples.length < sampleSize;
        i += step
      ) {
        const vector = allVectors[i];

        // Use AI-generated keywords from database (already in keywords column)
        const keywords = vector.keywords || [];

        samples.push({
          title: vector.metadata?.title || `Document ${i + 1}`,
          content: vector.content,
          url: vector.metadata?.url,
          keywords,
        });
      }

      return samples;
    } catch (error) {
      console.error(`Error sampling documents from ${tableName}:`, error);
      return [];
    }
  }

  async analyzeCollection(
    storageService: PostgresService,
    tableName: string,
    collectionId: string,
    maxSampleSize: number = 50
  ): Promise<CollectionTaxonomy> {
    console.log(`Analyzing collection: ${collectionId}`);
    console.log(`Note: tableName and maxSampleSize parameters are deprecated - using ALL document taxonomies`);

    // 1. Load ALL document taxonomies from knowledge_documents table
    // This ensures the collection taxonomy reflects ALL documents, not just recent additions
    const documentTaxonomies = await this.loadAllDocumentTaxonomies(
      storageService,
      collectionId
    );

    if (documentTaxonomies.length === 0) {
      throw new Error(`No documents with taxonomies found in collection: ${collectionId}`);
    }

    console.log(`Loaded ${documentTaxonomies.length} document taxonomies for analysis`);

    // 2. Aggregate topics, tags, entities across ALL document taxonomies
    const taxonomyAnalysis = this.analyzeDocumentTaxonomies(documentTaxonomies);

    console.log(`Aggregated insights from ALL ${documentTaxonomies.length} documents:`);
    console.log(`  - Unique topics: ${taxonomyAnalysis.allTopics.length}`);
    console.log(`  - Unique tags: ${taxonomyAnalysis.allTags.length}`);
    console.log(`  - Unique entities: ${taxonomyAnalysis.allEntities.length}`);

    // 3. Generate AI-powered collection-level taxonomy and insights
    const aiInsights = await this.generateAIInsightsFromTaxonomies(
      documentTaxonomies,
      taxonomyAnalysis
    );

    // 4. Generate suggested queries
    const suggestedQueries = await this.generateSuggestedQueriesFromTaxonomies(
      documentTaxonomies,
      taxonomyAnalysis,
      aiInsights
    );

    // 5. Compile final taxonomy
    const taxonomy: CollectionTaxonomy = {
      overview: aiInsights.overview,
      primaryTopics: aiInsights.primaryTopics,
      secondaryTopics: aiInsights.secondaryTopics,
      keyThemes: aiInsights.keyThemes,
      targetAudience: aiInsights.targetAudience,
      contentTypes: aiInsights.contentTypes,
      suggestedQueries,
      metadata: {
        totalDocuments: documentTaxonomies.length,
        topKeywords: taxonomyAnalysis.allTopics.slice(0, 20), // Use top topics as keywords
        generatedAt: new Date().toISOString(),
        collectionName: collectionId,
      },
    };

    console.log(`Collection analysis complete (based on ALL ${documentTaxonomies.length} documents)`);
    return taxonomy;
  }

  async saveTaxonomy(
    storageService: PostgresService,
    collectionName: string,
    taxonomy: CollectionTaxonomy
  ): Promise<void> {
    // Create taxonomy table if it doesn't exist
    await this.createTaxonomyTable(storageService);

    // Store taxonomy as JSON
    const query = `
    INSERT INTO collection_taxonomies (collection_name, taxonomy_data, created_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (collection_name) DO UPDATE SET
      taxonomy_data = EXCLUDED.taxonomy_data,
      updated_at = CURRENT_TIMESTAMP;
  `;

    await storageService.query(query, [
      collectionName,
      JSON.stringify(taxonomy),
    ]);
    console.log(`Taxonomy saved for collection: ${collectionName}`);
  }

  private async createTaxonomyTable(
    storageService: PostgresService
  ): Promise<void> {
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS collection_taxonomies (
      collection_name VARCHAR(255) PRIMARY KEY,
      taxonomy_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

    await storageService.query(createTableQuery);
  }

  async loadTaxonomy(
    storageService: PostgresService,
    collectionName: string
  ): Promise<CollectionTaxonomy | null> {
    try {
      // First check if the table exists
      const tableCheckQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'collection_taxonomies'
      );
    `;

      const tableExists = await storageService.query(tableCheckQuery);

      if (!tableExists.rows[0].exists) {
        // Table doesn't exist, so no taxonomy can be loaded
        return null;
      }

      // Table exists, try to load the taxonomy
      const query = `SELECT taxonomy_data FROM collection_taxonomies WHERE collection_name = $1`;
      const result = await storageService.query(query, [collectionName]);

      if (result.rows.length > 0) {
        // taxonomy_data is already a JSON object when retrieved from JSONB column
        return result.rows[0].taxonomy_data;
      }

      return null;
    } catch (error) {
      console.warn(`Could not load taxonomy for ${collectionName}:`, error);
      return null;
    }
  }

  generateTaxonomyReport(taxonomy: CollectionTaxonomy): string {
    return `
# Collection Analysis: ${taxonomy.metadata.collectionName}

**Generated:** ${new Date(taxonomy.metadata.generatedAt).toLocaleDateString()}
**Documents Analyzed:** ${taxonomy.metadata.totalDocuments}

## Overview

${taxonomy.overview}

## Primary Topics

${taxonomy.primaryTopics.map((topic) => `- ${topic}`).join("\n")}

## Secondary Topics

${taxonomy.secondaryTopics.map((topic) => `- ${topic}`).join("\n")}

## Key Themes

${taxonomy.keyThemes.map((theme) => `- ${theme}`).join("\n")}

## Target Audience

${taxonomy.targetAudience.map((audience) => `- ${audience}`).join("\n")}

## Content Types

${taxonomy.contentTypes.map((type) => `- ${type}`).join("\n")}

## Suggested Search Queries

### Semantic Queries (Conceptual)
${taxonomy.suggestedQueries.semantic.map((q) => `- "${q}"`).join("\n")}

### Technical Queries (Specific)
${taxonomy.suggestedQueries.technical.map((q) => `- "${q}"`).join("\n")}

### Exploratory Queries (Discovery)
${taxonomy.suggestedQueries.exploratory.map((q) => `- "${q}"`).join("\n")}

## Top Keywords

${taxonomy.metadata.topKeywords.slice(0, 20).join(", ")}

---

*This analysis was generated automatically using AI-powered keyword extraction and analysis.*
`;
  }

}