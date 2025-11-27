import { ChunkedDocument } from "./vector-index";

export interface ContextualChunkConfig {
  maxChunkSize?: number;
  includeDocumentContext?: boolean;
}

export class ContextualChunker {
  private config: ContextualChunkConfig;

  constructor(config: ContextualChunkConfig = {}) {
    this.config = config;
  }

  async enhanceChunks(
    chunks: ChunkedDocument[],
    documentTaxonomies?: Map<string, any>
  ): Promise<ChunkedDocument[]> {
    console.log(
      `Enhancing ${chunks.length} chunks with contextual content...`
    );

    // Enhance each chunk with contextual content from document taxonomy
    const enhancedChunks = chunks.map((chunk) => {
      // Get document taxonomy if available
      const documentId = chunk.metadata?.documentId;
      const taxonomy = documentId && documentTaxonomies?.has(documentId)
        ? documentTaxonomies.get(documentId)
        : null;

      // Build contextual content from taxonomy fields
      const keywords: string[] = [];

      // Add document taxonomy fields if available
      if (taxonomy) {
        // Add main topics (most important)
        if (taxonomy.mainTopics && Array.isArray(taxonomy.mainTopics)) {
          keywords.push(...taxonomy.mainTopics);
        }

        // Add tags
        if (taxonomy.tags && Array.isArray(taxonomy.tags)) {
          keywords.push(...taxonomy.tags);
        }

        // Add key entities
        if (taxonomy.keyEntities && Array.isArray(taxonomy.keyEntities)) {
          keywords.push(...taxonomy.keyEntities);
        }

        // Add document type
        if (taxonomy.documentType) {
          keywords.push(taxonomy.documentType);
        }
      }

      // Join all keywords into contextual content
      const contextualContent = keywords.length > 0 ? keywords.join(", ") : undefined;

      return {
        ...chunk,
        contextualContent,
      };
    });

    console.log(
      `Enhanced ${enhancedChunks.length} chunks with taxonomy-based contextual content`
    );
    return enhancedChunks;
  }

}