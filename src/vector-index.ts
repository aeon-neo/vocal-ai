/**
 * Vector Index Service - RAG Knowledge Base Search
 *
 * Manages embedding generation and hybrid search across document collections.
 * Core component of VocalAI's knowledge retrieval system.
 *
 * Key Features:
 * - Generates 1536-dim embeddings using OpenAI text-embedding-3-small
 * - Two-tier hybrid search: Vector similarity + AI keyword ranking
 * - Reciprocal Rank Fusion (RRF) for combining search results
 * - Collection-based filtering for multi-tenant knowledge base
 * - Used by Cortex Agent for RAG queries during examination
 */

import OpenAI from "openai";
import { PostgresService, VectorDocument } from "./storage";
import { HybridSearchEngine } from "./hybrid-search";
import { SearchResult, DocumentChunk, HybridSearchConfig } from "./lib/types";

export interface VectorConfig {
  // Storage service for vector operations
  storageService: PostgresService;

  // OpenAI API key for embeddings
  openaiApiKey?: string;

  // Vector table configuration
  tableName?: string;
  embeddingDimensions?: number; // 1536 for text-embedding-3-small

  // Hybrid search configuration
  hybridSearch?: HybridSearchConfig;
}

export interface ChunkedDocument {
  id: string;
  text: string;
  contextualContent?: string; // For contextual embeddings
  metadata: {
    source: string;
    title: string;
    chunkIndex: number;
    totalChunks: number;
    [key: string]: any;
  };
}

export class VectorIndexService {
  private storageService: PostgresService;
  private openaiClient: OpenAI;
  private config: VectorConfig;
  private tableName: string;
  private dimensions: number;
  private hybridSearchEngine: HybridSearchEngine;
  private documentsCorpus: DocumentChunk[] = [];
  private verbose: boolean = false;

  constructor(config: VectorConfig) {
    this.config = config;
    this.storageService = config.storageService;
    this.tableName = config.tableName || "document_embeddings";
    this.dimensions = config.embeddingDimensions || 1536; // OpenAI text-embedding-3-small

    // Initialize OpenAI client
    this.openaiClient = new OpenAI({
      apiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
    });

    // Initialize hybrid search engine
    this.hybridSearchEngine = new HybridSearchEngine(config.hybridSearch || {});
  }

  async initialize(): Promise<void> {
    // console.log(" Initializing Vector Index Service");
    // console.log(" Using OpenAI text-embedding-3-small");
    // console.log(` Dimensions: ${this.dimensions}`);

    // Vector table (knowledge_embeddings) is already created in schema
    // No need to create it dynamically

    // console.log("Vector Index Service initialized");
    // console.log(` Table: ${this.tableName}`);
  }

  /**
   * Set verbose mode for logging
   */
  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(...args: any[]) {
    if (this.verbose) {
      console.log('[VectorIndex]', ...args);
    }
  }

  async generateEmbeddings(
    chunks: ChunkedDocument[]
  ): Promise<VectorDocument[]> {
    this.log(`Generating embeddings for ${chunks.length} chunks...`);

    // Generate embeddings for all chunks
    const vectors: VectorDocument[] = [];

    // Process in batches (OpenAI allows up to 2048 inputs per request)
    const batchSize = 100;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      this.log(
        `   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          chunks.length / batchSize
        )}...`
      );

      // Generate embeddings for batch using OpenAI
      // Use contextual content if available, otherwise fall back to raw text
      const texts = batch.map((chunk) => chunk.contextualContent || chunk.text);

      const response = await this.openaiClient.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
        dimensions: this.dimensions,
      });

      // Create vector documents
      batch.forEach((chunk, idx) => {
        vectors.push({
          id: chunk.id,
          content: chunk.text,
          embedding: response.data[idx].embedding,
          metadata: {
            ...chunk.metadata,
            contextualContent: chunk.contextualContent, // Store actual contextual content
          },
        });
      });
    }

    this.log(`Generated ${vectors.length} embeddings`);
    return vectors;
  }

  async createEmbeddings(chunks: ChunkedDocument[]): Promise<void> {
    this.log(` Creating embeddings for ${chunks.length} chunks...`);

    // Generate embeddings using the dedicated method
    const vectors = await this.generateEmbeddings(chunks);

    // Store vectors using storage service (knowledge_embeddings table)
    await this.storageService.storeKnowledgeVectors(vectors);

    this.log(`Created and stored ${vectors.length} embeddings`);
  }

  async loadDocumentCorpus(collectionId?: string | string[]): Promise<void> {
    // Get all vectors from storage to build AI keyword corpus
    let allVectors: any[];

    if (collectionId) {
      if (Array.isArray(collectionId)) {
        // Get vectors for multiple collections
        const query = `
          SELECT id, content, embedding, metadata, collection_id, keywords
          FROM knowledge_embeddings
          WHERE collection_id = ANY($1)
          ORDER BY created_at DESC
          LIMIT 10000;
        `;
        const result = await this.storageService.query(query, [collectionId]);
        allVectors = result.rows.map((row: any) => ({
          id: row.id,
          content: row.content,
          // pgvector returns a string like "[0.123,0.456,...]", parse it to number array
          embedding: typeof row.embedding === 'string'
            ? JSON.parse(row.embedding)
            : Array.isArray(row.embedding)
              ? row.embedding
              : Array.from(row.embedding),
          metadata: row.metadata,
          collectionId: row.collection_id,
          keywords: row.keywords || [], // AI-generated keywords from database
        }));
      } else {
        // Get vectors for specific collection
        const vectors = await this.storageService.getAllKnowledgeVectors({
          collectionId: collectionId
        });
        allVectors = vectors.map((v: any) => ({
          ...v,
          collectionId: v.collectionId || collectionId, // Ensure collectionId is set
          keywords: v.keywords || [], // AI-generated keywords
        }));
      }
    } else {
      // Get ALL vectors across all collections
      const query = `
        SELECT id, content, embedding, metadata, collection_id, keywords
        FROM knowledge_embeddings
        ORDER BY created_at DESC
        LIMIT 10000;
      `;
      const result = await this.storageService.query(query);
      allVectors = result.rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        // pgvector returns a string like "[0.123,0.456,...]", parse it to number array
        embedding: typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : Array.isArray(row.embedding)
            ? row.embedding
            : Array.from(row.embedding),
        metadata: row.metadata,
        collectionId: row.collection_id,
        keywords: row.keywords || [], // AI-generated keywords from database
      }));
    }

    // Convert to DocumentChunk format for hybrid search
    this.documentsCorpus = allVectors.map((vector: any) => ({
      id: vector.id,
      content: vector.content,
      metadata: {
        ...vector.metadata,
        collectionId: vector.collectionId, // Add collection ID to metadata
        keywords: vector.keywords, // Include AI keywords for Tier 2 search
      },
      contextualContent: vector.metadata?.contextualContent,
    }));
  }

  async search(
    query: string,
    topK: number = 5,
    options?: {
      taxonomyFilters?: import("./lib/types").TaxonomyFilters;
      collectionId?: string | string[];
      verbose?: boolean;
      useTaxonomy?: boolean;
      vectorOnly?: boolean;
    }
  ): Promise<SearchResult[] | any> {
    // Vector-only mode: Skip expensive hybrid search (AI keywords, taxonomy, RRF)
    // Use for lesson plan queries where we just need fast vector similarity
    if (options?.vectorOnly) {
      if ((global as any).VERBOSE_LOGGING) {
        this.log("[VECTOR-INDEX] Vector-only mode: skipping hybrid search");
      }

      // Generate query embedding using OpenAI
      const response = await this.openaiClient.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
        dimensions: this.dimensions,
      });
      const queryEmbedding = response.data[0].embedding;
      const results = await this.storageService.searchKnowledgeVectors(
        queryEmbedding,
        topK,
        { collectionId: options?.collectionId }
      );

      return results.map((result: any) => ({
        chunk: {
          id: result.id,
          content: result.content,
          metadata: {
            ...result.metadata,
            collectionId: result.collectionId,
          },
          contextualContent: result.metadata?.contextualContent,
        },
        score: result.similarity,
        vectorScore: result.similarity,
        method: "vector" as const,
      }));
    }

    // Full hybrid search mode
    if ((global as any).VERBOSE_LOGGING) {
      this.log("[VECTOR-INDEX] Full hybrid search mode: Vector + AI Keywords + RRF");
    }

    // Always reload corpus from database for AI keyword search
    // This ensures we have the latest documents and keywords (no stale cache)
    // Load corpus with same collection filter as vector search for consistency
    await this.loadDocumentCorpus(options?.collectionId);

    // Vector search function for hybrid search
    const vectorSearchFn = async (
      searchQuery: string,
      vectorTopK: number
    ): Promise<SearchResult[]> => {
      // Generate query embedding using OpenAI
      const response = await this.openaiClient.embeddings.create({
        model: "text-embedding-3-small",
        input: searchQuery,
        dimensions: this.dimensions,
      });
      const queryEmbedding = response.data[0].embedding;

      const results = await this.storageService.searchKnowledgeVectors(
        queryEmbedding,
        vectorTopK,
        { collectionId: options?.collectionId }
      );

      return results.map((result: any) => ({
        chunk: {
          id: result.id,
          content: result.content,
          metadata: {
            ...result.metadata,
            collectionId: result.collectionId, // Add collection ID to metadata
          },
          contextualContent: result.metadata?.contextualContent,
        },
        score: result.similarity,
        vectorScore: result.similarity,
        method: "vector" as const,
      }));
    };

    // Perform hybrid search with RRF
    const hybridResults = await this.hybridSearchEngine.hybridSearch(
      query,
      this.documentsCorpus,
      vectorSearchFn,
      {
        verbose: options?.verbose,
      }
    );

    // If verbose mode, return detailed breakdown as-is
    if (options?.verbose) {
      return hybridResults;
    }

    // Normal mode: return final results sliced to topK
    return (hybridResults as SearchResult[]).slice(0, topK);
  }


  async getStats(): Promise<{
    indexExists: boolean;
    documentCount?: number;
    tableName: string;
    dimensions: number;
  }> {
    // Check if table exists and count documents
    const result = await this.storageService.query(
      `SELECT COUNT(*) as count FROM ${this.tableName}`
    );

    return {
      indexExists: true,
      documentCount: parseInt(result.rows[0]?.count || 0),
      tableName: this.tableName,
      dimensions: this.dimensions,
    };
  }

  async clearIndex(collectionId?: string): Promise<void> {
    // Can't clear entire table - would affect all collections
    // Instead, delete by collection_id if provided
    if (collectionId) {
      await this.storageService.query(
        `DELETE FROM knowledge_embeddings WHERE collection_id = $1 AND is_system = FALSE`,
        [collectionId]
      );
    } else {
      console.warn("clearIndex called without collectionId - skipping to preserve other collections");
    }
  }

  async hasEmbeddings(): Promise<boolean> {
    const stats = await this.getStats();
    return stats.indexExists && (stats.documentCount || 0) > 0;
  }

}

export function createVectorService(
  storageService: PostgresService,
  embeddingType?: HuggingFaceEmbeddingModelType,
  tableName?: string
): VectorIndexService {
  return new VectorIndexService({
    storageService,
    embeddingModel: embeddingType ? { type: embeddingType } : undefined,
    tableName,
  });
}