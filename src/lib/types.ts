// ============================================================================
// CWSB Document Types
// ============================================================================

export interface PDFDocument {
  id: string;
  content: string;
  metadata: {
    fileName: string;
    title: string;
    author?: string;
    publicationDate?: string; // ISO date string or extracted date
    sourceUrl?: string; // URL if downloaded from online source
    hash: string;
    pageCount: number;
    timestamp: number;
    tags?: string[]; // Tags from markdown frontmatter
    fileType?: string; // Document type (pdf, markdown, docx)
  };
}

export interface KnowledgeDocument {
  id: string;
  fileHash: string;
  fileName: string;
  title: string;
  author?: string;
  publicationDate?: Date;
  sourceUrl?: string;
  collectionId: string;
  pageCount?: number;
  content: string;
  aiTaxonomy?: any; // AI-generated document taxonomy (DocumentTaxonomy from document-taxonomy.ts)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DocumentCollection {
  id: string;
  name: string;
  taxonomy?: any; // AI-generated taxonomy (superior to manual description)
  createdAt?: Date;
  updatedAt?: Date;
}

// Legacy type (kept for backward compatibility)
export interface QALogEntry {
  id?: number;
  sessionId: string;
  question: string;
  answer: string;
  citations?: string[];
  topics: string[];
  embeddingTimeMs?: number;
  retrievalTimeMs?: number;
  llmTimeMs?: number;
  createdAt?: Date;
}

// New usage log entry for business intelligence and rate limiting
export interface UsageLogEntry {
  id?: number;
  ipAddress: string;
  sessionId: string;
  assistantId?: string; // Which assistant handled the query
  question: string;
  answer: string;
  citations?: string[];
  topics: string[];
  inputTokens?: number; // From Claude API response
  outputTokens?: number; // From Claude API response
  embeddingTimeMs?: number;
  retrievalTimeMs?: number;
  llmTimeMs?: number;
  createdAt?: Date;
}

// User feedback entry
export interface FeedbackEntry {
  id?: number;
  ipAddress: string;
  sessionId?: string;
  email?: string;
  comment: string;
  userAgent?: string;
  createdAt?: Date;
}

// ============================================================================
// RAG & Vector Search Types
// ============================================================================

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
  contextualContent?: string; // For contextual embeddings
}

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  taxonomyScore?: number;
  combinedScore?: number;
  method: "vector" | "keyword" | "taxonomy" | "hybrid";
}

export interface HybridSearchConfig {
  vectorWeight?: number; // Weight for vector similarity (default: 0.7)
  keywordWeight?: number; // Weight for AI keyword score (default: 0.3)
  taxonomyWeight?: number; // Weight for taxonomy score (default: 0.2)
  topK?: number; // Number of results to return (default: 5)
  vectorTopK?: number; // Number of vector results to consider (default: 5)
  keywordTopK?: number; // Number of AI keyword results to consider (default: 5)
  taxonomyTopK?: number; // Number of taxonomy results to consider (default: 5)
  minScore?: number; // Minimum combined score threshold (default: 0.05)
  useRRF?: boolean; // Use Reciprocal Rank Fusion instead of weighted combination (default: true)
  rrfK?: number; // RRF constant k parameter (default: 1)
  prioritizeDocumentTypes?: string[]; // Prioritize specific document types
}

// ============================================================================
// Two-Tier Query System Types
// ============================================================================

export interface TaxonomyFilters {
  documentTypes?: string[]; // Filter by document type (e.g., ['legislation', 'guidance'])
  tags?: string[]; // Filter by AI-generated tags (e.g., ['registration-procedures'])
  topics?: string[]; // Filter by main topics (e.g., ['school-admissions'])
  entities?: string[]; // Filter by key entities (e.g., ['Department for Education'])
}

export interface HybridSearchOptions {
  documentTaxonomies?: Map<string, any>; // Map of documentId -> AI taxonomy (METADATA ONLY, not used in ranking)
  taxonomyFilters?: TaxonomyFilters; // DEPRECATED: Taxonomy filtering no longer used
  verbose?: boolean; // Return detailed tier-by-tier results for debugging
}
