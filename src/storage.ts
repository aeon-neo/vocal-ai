/**
 * PostgreSQL Storage Service - Central Database Interface
 *
 * Single source of truth for all database operations across Niimi.
 * Manages connections, queries, and provides typed methods for all tables.
 *
 * Key Tables:
 * - Knowledge Base: document_collections, knowledge_documents, knowledge_embeddings
 * - Personal Assistant: user_profile, user_memories, user_tasks, user_events
 * - Relationship: relationship_state, relationship_evolution, conversation_history
 * - Motor Agent: action_queue, habit_patterns, executive_feedback
 * - Analytics: interaction_patterns, memory_events, usage_log
 *
 * All services interact with PostgreSQL through this service.
 */

import { Client } from "pg";
import {
  DocumentCollection,
  KnowledgeDocument,
  QALogEntry,
  UsageLogEntry,
  FeedbackEntry,
} from "./lib/types";

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  schema?: string; // PostgreSQL schema name (defaults to 'public')
}

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
}

export interface UserProfile {
  id: number;
  name?: string;
  email?: string;
  timezone: string;
  preferences: Record<string, any>;
  importantDates: any[];
  relationships: any[];
  contextMemory: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserMemory {
  id: number;
  memoryType: string;
  content: string;
  embedding?: number[];
  sourceType?: string;
  sourceId?: string;
  confidence: number;
  importance: number;
  lastAccessedAt: Date;
  lastConfirmedAt?: Date;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserTask {
  id: number;
  title: string;
  description?: string;
  dueDate?: Date;
  priority: string;
  status: string;
  sourceType?: string;
  sourceId?: string;
  reminderSent: boolean;
  reminderCount: number;
  metadata: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

export interface AIPersonalityState {
  id: number;
  relationshipStage: string;
  interactionCount: number;
  depthScore: number;
  trustLevel: number;
  communicationStyle: Record<string, any>;
  personalityTraits: Record<string, any>;
  evolutionHistory: any[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  embedding?: number[];
  keywords?: string[]; // Emotional/semantic tags from Limbic for hybrid search
  metadata: Record<string, any>;
  createdAt: Date;
}

/**
 * PostgreSQL Service for Personal AI Assistant
 * Manages document collections, knowledge base, user profiles,
 * memories, tasks, and AI personality state.
 *
 * Uses connection pooling for better performance and reliability:
 */
export class PostgresService {
  public readonly config: PostgresConfig;
  private client: Client;
  private schema: string;

  constructor(config: PostgresConfig) {
    this.config = config;
    this.schema = config.schema || 'public';
    this.client = new Client(config);
  }

  /**
   * Create all database tables
   * Note: For production, use migrations instead of this method
   */
  private async createTables(): Promise<void> {
    // Document Collections table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS document_collections (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        taxonomy JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Knowledge Documents table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id VARCHAR(255) PRIMARY KEY,
        file_hash VARCHAR(255) UNIQUE NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        title TEXT NOT NULL,
        author VARCHAR(255),
        publication_date DATE,
        source_url TEXT,
        collection_id VARCHAR(255) REFERENCES document_collections(id),
        page_count INTEGER,
        content TEXT NOT NULL,
        ai_taxonomy JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Knowledge Embeddings table (unified vector storage)
    // OpenAI text-embedding-3-small produces 1536-dimensional vectors
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_embeddings (
        id VARCHAR(255) PRIMARY KEY,
        document_id VARCHAR(255) REFERENCES knowledge_documents(id),
        collection_id VARCHAR(255) REFERENCES document_collections(id),
        content TEXT NOT NULL,
        contextual_content TEXT,
        embedding vector(1536) NOT NULL,
        keywords TEXT[],
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Q&A Log table (kept for analytics)
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS qa_log (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations JSONB,
        topics TEXT[],
        embedding_time_ms INTEGER,
        retrieval_time_ms INTEGER,
        llm_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Usage Log table (analytics & rate limiting)
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS usage_log (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        assistant_id VARCHAR(255),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations JSONB,
        topics TEXT[],
        input_tokens INTEGER,
        output_tokens INTEGER,
        embedding_time_ms INTEGER,
        retrieval_time_ms INTEGER,
        llm_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Feedback table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL,
        session_id VARCHAR(255),
        email VARCHAR(255),
        comment TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for performance
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_docs_collection
        ON knowledge_documents(collection_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_docs_hash
        ON knowledge_documents(file_hash);

      CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_doc
        ON knowledge_embeddings(document_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_collection
        ON knowledge_embeddings(collection_id);

      CREATE INDEX IF NOT EXISTS idx_qa_log_session
        ON qa_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_qa_log_created
        ON qa_log(created_at);

      CREATE INDEX IF NOT EXISTS idx_usage_log_ip
        ON usage_log(ip_address);
      CREATE INDEX IF NOT EXISTS idx_usage_log_session
        ON usage_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_usage_log_created
        ON usage_log(created_at);
    `);

    // Try to create vector index (may fail on small datasets)
    try {
      await this.client.query(`
        CREATE INDEX IF NOT EXISTS knowledge_embeddings_vector_idx
          ON knowledge_embeddings
          USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100);
      `);
      // console.log("Created vector index on knowledge_embeddings");
    } catch (error) {
      console.warn(
        `  Could not create vector index (may need more data): ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // console.log("Created/verified database tables");
  }

  /**
   * Initialize PostgreSQL connection and create tables
   */
  async initialize(): Promise<void> {
    // console.log(
    //   `Connecting to PostgreSQL at ${this.config.host}:${this.config.port}/${this.config.database} (schema: ${this.schema})`
    // );

    await this.client.connect();

    // Create schema if it doesn't exist
    if (this.schema !== 'public') {
      await this.client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema};`);
      console.log(`Created/verified schema: ${this.schema}`);
    }

    // Set search_path to use the specified schema
    await this.client.query(`SET search_path TO ${this.schema}, public;`);

    // Enable pgvector extension
    await this.client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    // Create tables (in production, use migrations instead)
    await this.createTables();

    // console.log("PostgreSQL initialized successfully");
  }

  // ============================================================================
  // Document Collections
  // ============================================================================

  async storeCollection(collection: DocumentCollection): Promise<void> {
    const query = `
      INSERT INTO document_collections (id, name, taxonomy, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        taxonomy = EXCLUDED.taxonomy,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await this.client.query(query, [
      collection.id,
      collection.name,
      JSON.stringify(collection.taxonomy || {}),
    ]);

    console.log(`Stored collection: ${collection.name}`);
  }

  async getCollection(collectionId: string): Promise<DocumentCollection | null> {
    const query = `SELECT * FROM document_collections WHERE id = $1`;
    const result = await this.client.query(query, [collectionId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      taxonomy: row.taxonomy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getCollectionIds(): Promise<string[]> {
    const query = `SELECT id FROM document_collections ORDER BY name`;
    const result = await this.client.query(query);
    return result.rows.map((row) => row.id);
  }

  async updateCollectionTaxonomy(
    collectionId: string,
    taxonomy: any
  ): Promise<void> {
    const query = `
      UPDATE document_collections
      SET taxonomy = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;

    await this.client.query(query, [collectionId, JSON.stringify(taxonomy)]);
    console.log(`Updated taxonomy for collection: ${collectionId}`);
  }

  // ============================================================================
  // Knowledge Documents
  // ============================================================================

  async storeKnowledgeDocuments(documents: KnowledgeDocument[]): Promise<void> {
    const query = `
      INSERT INTO knowledge_documents
        (id, file_hash, file_name, title, author, publication_date, source_url,
         collection_id, page_count, content, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (file_hash) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        collection_id = EXCLUDED.collection_id,
        updated_at = CURRENT_TIMESTAMP;
    `;

    for (const doc of documents) {
      await this.client.query(query, [
        doc.id,
        doc.fileHash,
        doc.fileName,
        doc.title,
        doc.author || null,
        doc.publicationDate || null,
        doc.sourceUrl || null,
        doc.collectionId,
        doc.pageCount || null,
        doc.content,
        doc.createdAt,
        doc.updatedAt,
      ]);
    }

    console.log(`Stored ${documents.length} knowledge documents`);
  }

  async updateDocumentTaxonomy(
    documentId: string,
    taxonomy: any
  ): Promise<void> {
    const query = `
      UPDATE knowledge_documents
      SET ai_taxonomy = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;

    await this.client.query(query, [documentId, JSON.stringify(taxonomy)]);
  }

  async getDocumentsWithoutTaxonomy(
    collectionId?: string
  ): Promise<KnowledgeDocument[]> {
    let query = `
      SELECT * FROM knowledge_documents
      WHERE ai_taxonomy IS NULL
    `;
    const params: any[] = [];

    if (collectionId) {
      query += ` AND collection_id = $1`;
      params.push(collectionId);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      fileHash: row.file_hash,
      fileName: row.file_name,
      title: row.title,
      author: row.author,
      publicationDate: row.publication_date,
      sourceUrl: row.source_url,
      collectionId: row.collection_id,
      pageCount: row.page_count,
      content: row.content,
      aiTaxonomy: row.ai_taxonomy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getKnowledgeDocuments(filters?: {
    collectionId?: string | string[];
    hasContent?: boolean;
  }): Promise<KnowledgeDocument[]> {
    let query = `SELECT * FROM knowledge_documents WHERE 1=1`;
    const params: any[] = [];

    if (filters?.collectionId) {
      if (Array.isArray(filters.collectionId)) {
        params.push(filters.collectionId);
        query += ` AND collection_id = ANY($${params.length})`;
      } else {
        params.push(filters.collectionId);
        query += ` AND collection_id = $${params.length}`;
      }
    }

    if (filters?.hasContent !== undefined) {
      query += ` AND content IS ${filters.hasContent ? 'NOT NULL' : 'NULL'}`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      fileHash: row.file_hash,
      fileName: row.file_name,
      title: row.title,
      author: row.author,
      publicationDate: row.publication_date,
      sourceUrl: row.source_url,
      collectionId: row.collection_id,
      pageCount: row.page_count,
      content: row.content,
      aiTaxonomy: row.ai_taxonomy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getDocumentsByIds(documentIds: string[]): Promise<any[]> {
    if (documentIds.length === 0) return [];

    const query = `
      SELECT * FROM knowledge_documents
      WHERE id = ANY($1)
      ORDER BY created_at DESC
    `;

    const result = await this.client.query(query, [documentIds]);
    return result.rows;
  }

  // ============================================================================
  // Knowledge Embeddings (Vector Storage)
  // ============================================================================

  async createKnowledgeVectorTable(dimensions: number = 1536): Promise<void> {
    // Table is created in createTables() with 1536 dimensions (OpenAI embeddings)
    console.log(`Knowledge embeddings table uses ${dimensions} dimensions`);
  }

  async storeKnowledgeVectors(vectors: VectorDocument[]): Promise<void> {
    const query = `
      INSERT INTO knowledge_embeddings
        (id, document_id, collection_id, content, contextual_content,
         embedding, keywords, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        contextual_content = EXCLUDED.contextual_content,
        embedding = EXCLUDED.embedding,
        keywords = EXCLUDED.keywords,
        metadata = EXCLUDED.metadata;
    `;

    for (const vector of vectors) {
      await this.client.query(query, [
        vector.id,
        vector.metadata.documentId || null,
        vector.metadata.collectionId || null,
        vector.content,
        vector.metadata.contextualContent || null,
        `[${vector.embedding.join(",")}]`,
        vector.metadata.keywords || null,
        JSON.stringify(vector.metadata),
        new Date(),
      ]);
    }

    console.log(`Stored ${vectors.length} knowledge vectors`);
  }

  async getAllKnowledgeVectors(
    filters?: {
      collectionId?: string | string[];
      documentId?: string;
    }
  ): Promise<VectorDocument[]> {
    let query = `SELECT * FROM knowledge_embeddings WHERE 1=1`;
    const params: any[] = [];

    if (filters?.collectionId) {
      if (Array.isArray(filters.collectionId)) {
        params.push(filters.collectionId);
        query += ` AND collection_id = ANY($${params.length})`;
      } else {
        params.push(filters.collectionId);
        query += ` AND collection_id = $${params.length}`;
      }
    }

    if (filters?.documentId) {
      params.push(filters.documentId);
      query += ` AND document_id = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      embedding: row.embedding,
      metadata: {
        ...row.metadata,
        documentId: row.document_id,
        collectionId: row.collection_id,
        contextualContent: row.contextual_content,
        keywords: row.keywords,
      },
    }));
  }

  async searchKnowledgeVectors(
    queryEmbedding: number[],
    topK: number,
    filters?: {
      collectionId?: string | string[];
    }
  ): Promise<Array<VectorDocument & { similarity: number }>> {
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    let query = `
      SELECT
        id, document_id, collection_id, content, contextual_content,
        embedding, keywords, metadata,
        1 - (embedding <=> $1::vector) as similarity
      FROM knowledge_embeddings
      WHERE 1=1
    `;

    const params: any[] = [embeddingStr];

    if (filters?.collectionId) {
      if (Array.isArray(filters.collectionId)) {
        params.push(filters.collectionId);
        query += ` AND collection_id = ANY($${params.length})`;
      } else {
        params.push(filters.collectionId);
        query += ` AND collection_id = $${params.length}`;
      }
    }

    query += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
    params.push(topK);

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      embedding: row.embedding,
      similarity: parseFloat(row.similarity),
      metadata: {
        ...row.metadata,
        documentId: row.document_id,
        collectionId: row.collection_id,
        contextualContent: row.contextual_content,
        keywords: row.keywords,
      },
    }));
  }

  async getKnowledgeVectorStats(collectionId?: string): Promise<{
    count: number;
    avgEmbeddingLength: number;
  }> {
    let query = `
      SELECT
        COUNT(*) as count,
        AVG(array_length(embedding, 1)) as avg_length
      FROM knowledge_embeddings
    `;

    const params: any[] = [];

    if (collectionId) {
      params.push(collectionId);
      query += ` WHERE collection_id = $1`;
    }

    const result = await this.client.query(query, params);

    return {
      count: parseInt(result.rows[0].count),
      avgEmbeddingLength: parseFloat(result.rows[0].avg_length || "0"),
    };
  }

  // ============================================================================
  // Q&A Logging (Analytics)
  // ============================================================================

  async logQA(log: QALogEntry): Promise<void> {
    const query = `
      INSERT INTO qa_log
        (session_id, question, answer, citations, topics,
         embedding_time_ms, retrieval_time_ms, llm_time_ms, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await this.client.query(query, [
      log.sessionId,
      log.question,
      log.answer,
      JSON.stringify(log.citations || []),
      log.topics || [],
      log.embeddingTimeMs,
      log.retrievalTimeMs,
      log.llmTimeMs,
      new Date(),
    ]);
  }

  async getQALog(sessionId: string): Promise<QALogEntry[]> {
    const query = `
      SELECT * FROM qa_log
      WHERE session_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.client.query(query, [sessionId]);

    return result.rows.map((row) => ({
      sessionId: row.session_id,
      question: row.question,
      answer: row.answer,
      citations: row.citations,
      topics: row.topics,
      embeddingTimeMs: row.embedding_time_ms,
      retrievalTimeMs: row.retrieval_time_ms,
      llmTimeMs: row.llm_time_ms,
      createdAt: row.created_at,
    }));
  }

  // ============================================================================
  // Usage Logging (Business Intelligence & Rate Limiting)
  // ============================================================================

  async logUsage(log: UsageLogEntry): Promise<void> {
    const query = `
      INSERT INTO usage_log
        (ip_address, session_id, assistant_id, question, answer, citations, topics,
         input_tokens, output_tokens, embedding_time_ms, retrieval_time_ms,
         llm_time_ms, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    await this.client.query(query, [
      log.ipAddress,
      log.sessionId,
      log.assistantId || null,
      log.question,
      log.answer,
      JSON.stringify(log.citations || []),
      log.topics || [],
      log.inputTokens,
      log.outputTokens,
      log.embeddingTimeMs,
      log.retrievalTimeMs,
      log.llmTimeMs,
      new Date(),
    ]);
  }

  async logFeedback(feedback: FeedbackEntry): Promise<void> {
    const query = `
      INSERT INTO feedback (ip_address, session_id, email, comment, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await this.client.query(query, [
      feedback.ipAddress,
      feedback.sessionId || null,
      feedback.email || null,
      feedback.comment,
      feedback.userAgent || null,
      new Date(),
    ]);
  }

  async getUsageByIP(
    ipAddress: string,
    hoursAgo: number = 24
  ): Promise<{ count: number; totalTokens: number }> {
    const query = `
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
      FROM usage_log
      WHERE ip_address = $1
        AND created_at > NOW() - INTERVAL '${hoursAgo} hours'
    `;

    const result = await this.client.query(query, [ipAddress]);

    return {
      count: parseInt(result.rows[0].count),
      totalTokens: parseInt(result.rows[0].total_tokens),
    };
  }

  async getUsageStats(filters?: {
    assistantId?: string;
    since?: Date;
  }): Promise<UsageLogEntry[]> {
    let query = `SELECT * FROM usage_log WHERE 1=1`;
    const params: any[] = [];

    if (filters?.assistantId) {
      params.push(filters.assistantId);
      query += ` AND assistant_id = $${params.length}`;
    }

    if (filters?.since) {
      params.push(filters.since);
      query += ` AND created_at > $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT 1000`;

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      ipAddress: row.ip_address,
      sessionId: row.session_id,
      assistantId: row.assistant_id,
      question: row.question,
      answer: row.answer,
      citations: row.citations,
      topics: row.topics,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      embeddingTimeMs: row.embedding_time_ms,
      retrievalTimeMs: row.retrieval_time_ms,
      llmTimeMs: row.llm_time_ms,
      createdAt: row.created_at,
    }));
  }

  // ============================================================================
  // Personal Assistant Methods
  // ============================================================================

  // User Profiles
  async getUserProfile(): Promise<UserProfile | null> {
    const query = `SELECT * FROM user_profile LIMIT 1`;
    const result = await this.client.query(query);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      timezone: row.timezone,
      preferences: row.preferences,
      importantDates: row.important_dates,
      relationships: row.relationships,
      contextMemory: row.context_memory,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createOrUpdateUserProfile(profile: Partial<UserProfile>): Promise<void> {
    const query = `
      INSERT INTO user_profile
        (id, name, email, timezone, preferences, important_dates,
         relationships, context_memory, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, user_profile.name),
        email = COALESCE(EXCLUDED.email, user_profile.email),
        timezone = COALESCE(EXCLUDED.timezone, user_profile.timezone),
        preferences = EXCLUDED.preferences,
        important_dates = EXCLUDED.important_dates,
        relationships = EXCLUDED.relationships,
        context_memory = EXCLUDED.context_memory,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await this.client.query(query, [
      profile.id || 1,
      profile.name || null,
      profile.email || null,
      profile.timezone || 'UTC',
      JSON.stringify(profile.preferences || {}),
      JSON.stringify(profile.importantDates || []),
      JSON.stringify(profile.relationships || []),
      JSON.stringify(profile.contextMemory || {}),
    ]);
  }

  // User Memories
  async storeMemory(memory: Omit<UserMemory, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const query = `
      INSERT INTO user_memories
        (memory_type, content, embedding, source_type, source_id,
         confidence, importance, last_accessed_at, last_confirmed_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9)
      RETURNING id;
    `;

    const embeddingStr = memory.embedding ? `[${memory.embedding.join(",")}]` : null;

    const result = await this.client.query(query, [
      memory.memoryType,
      memory.content,
      embeddingStr,
      memory.sourceType || null,
      memory.sourceId || null,
      memory.confidence,
      memory.importance,
      memory.lastConfirmedAt || null,
      JSON.stringify(memory.metadata),
    ]);

    return result.rows[0].id;
  }

  async searchMemories(
    queryEmbedding: number[],
    topK: number = 10,
    filters?: { memoryType?: string }
  ): Promise<Array<UserMemory & { similarity: number }>> {
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    let query = `
      SELECT *,
        1 - (embedding <=> $1::vector) as similarity
      FROM user_memories
      WHERE 1=1
    `;

    const params: any[] = [embeddingStr];

    if (filters?.memoryType) {
      params.push(filters.memoryType);
      query += ` AND memory_type = $${params.length}`;
    }

    query += ` ORDER BY similarity DESC, importance DESC, last_accessed_at DESC LIMIT $${params.length + 1}`;
    params.push(topK);

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      memoryType: row.memory_type,
      content: row.content,
      embedding: row.embedding,
      sourceType: row.source_type,
      sourceId: row.source_id,
      confidence: parseFloat(row.confidence),
      importance: parseFloat(row.importance),
      similarity: parseFloat(row.similarity),
      lastAccessedAt: row.last_accessed_at,
      lastConfirmedAt: row.last_confirmed_at,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getMemoriesByType(memoryType: string): Promise<UserMemory[]> {
    const query = `
      SELECT * FROM user_memories
      WHERE memory_type = $1
      ORDER BY importance DESC, last_accessed_at DESC
      LIMIT 50
    `;

    const result = await this.client.query(query, [memoryType]);

    return result.rows.map((row) => ({
      id: row.id,
      memoryType: row.memory_type,
      content: row.content,
      embedding: row.embedding,
      sourceType: row.source_type,
      sourceId: row.source_id,
      confidence: parseFloat(row.confidence),
      importance: parseFloat(row.importance),
      lastAccessedAt: row.last_accessed_at,
      lastConfirmedAt: row.last_confirmed_at,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updateMemoryAccess(memoryId: number): Promise<void> {
    await this.client.query(
      `UPDATE user_memories SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [memoryId]
    );
  }

  async updateMemoryConfidence(memoryId: number, confidence: number): Promise<void> {
    await this.client.query(
      `UPDATE user_memories SET confidence = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [memoryId, confidence]
    );
  }

  // User Tasks
  async createTask(task: Omit<UserTask, 'id' | 'createdAt'>): Promise<number> {
    const query = `
      INSERT INTO user_tasks
        (title, description, due_date, priority, status, source_type,
         source_id, reminder_sent, reminder_count, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id;
    `;

    const result = await this.client.query(query, [
      task.title,
      task.description || null,
      task.dueDate || null,
      task.priority,
      task.status,
      task.sourceType || null,
      task.sourceId || null,
      task.reminderSent,
      task.reminderCount,
      JSON.stringify(task.metadata),
    ]);

    return result.rows[0].id;
  }

  async getUserTasks(status?: string): Promise<UserTask[]> {
    let query = `SELECT * FROM user_tasks WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY due_date ASC NULLS LAST, priority DESC`;

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      dueDate: row.due_date,
      priority: row.priority,
      status: row.status,
      sourceType: row.source_type,
      sourceId: row.source_id,
      reminderSent: row.reminder_sent,
      reminderCount: row.reminder_count,
      metadata: row.metadata,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }

  async updateTaskStatus(taskId: number, status: string): Promise<void> {
    const completedAt = status === 'completed' ? 'CURRENT_TIMESTAMP' : 'NULL';

    await this.client.query(
      `UPDATE user_tasks SET status = $2, completed_at = ${completedAt} WHERE id = $1`,
      [taskId, status]
    );
  }

  // AI Personality State
  async getPersonalityState(): Promise<AIPersonalityState | null> {
    const query = `SELECT * FROM ai_personality_state LIMIT 1`;
    const result = await this.client.query(query);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      relationshipStage: row.relationship_stage,
      interactionCount: row.interaction_count,
      depthScore: parseFloat(row.depth_score),
      trustLevel: parseFloat(row.trust_level),
      communicationStyle: row.communication_style,
      personalityTraits: row.personality_traits,
      evolutionHistory: row.evolution_history,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updatePersonalityState(
    updates: Partial<AIPersonalityState>
  ): Promise<void> {
    const query = `
      INSERT INTO ai_personality_state
        (id, relationship_stage, interaction_count, depth_score, trust_level,
         communication_style, personality_traits, evolution_history, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        relationship_stage = COALESCE(EXCLUDED.relationship_stage, ai_personality_state.relationship_stage),
        interaction_count = COALESCE(EXCLUDED.interaction_count, ai_personality_state.interaction_count),
        depth_score = COALESCE(EXCLUDED.depth_score, ai_personality_state.depth_score),
        trust_level = COALESCE(EXCLUDED.trust_level, ai_personality_state.trust_level),
        communication_style = EXCLUDED.communication_style,
        personality_traits = EXCLUDED.personality_traits,
        evolution_history = EXCLUDED.evolution_history,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await this.client.query(query, [
      updates.id || 1,
      updates.relationshipStage || 'formal',
      updates.interactionCount || 0,
      updates.depthScore || 0.0,
      updates.trustLevel || 0.0,
      JSON.stringify(updates.communicationStyle || {}),
      JSON.stringify(updates.personalityTraits || {}),
      JSON.stringify(updates.evolutionHistory || []),
    ]);
  }

  // Conversation History
  async saveConversationMessage(message: Omit<ConversationMessage, 'id' | 'createdAt'>): Promise<void> {
    const embeddingStr = message.embedding ? `[${message.embedding.join(",")}]` : null;

    const query = `
      INSERT INTO conversation_history
        (session_id, role, content, embedding, keywords, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await this.client.query(query, [
      message.sessionId,
      message.role,
      message.content,
      embeddingStr,
      message.keywords || [],
      JSON.stringify(message.metadata),
    ]);
  }

  async getConversationHistory(
    sessionId?: string,
    limit: number = 50
  ): Promise<ConversationMessage[]> {
    let query = `
      SELECT * FROM conversation_history
      WHERE 1=1
    `;
    const params: any[] = [];

    if (sessionId) {
      params.push(sessionId);
      query += ` AND session_id = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.client.query(query, params);

    return result.rows.reverse().map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      embedding: row.embedding,
      keywords: row.keywords || [],
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  /**
   * Semantic search over conversation history using vector similarity
   *
   * Finds most relevant past conversations based on semantic similarity to query,
   * weighted by recency. Uses the same hybrid approach as memory search.
   */
  async searchConversationHistory(
    queryEmbedding: number[],
    topK: number = 10,
    recencyWeight: number = 0.3
  ): Promise<Array<ConversationMessage & { similarity: number; finalScore: number }>> {
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // Get recent pool for recency weighting (last 100 interactions)
    const query = `
      WITH scored AS (
        SELECT *,
          1 - (embedding <=> $1::vector) as similarity,
          ROW_NUMBER() OVER (ORDER BY created_at DESC) as recency_rank
        FROM conversation_history
        WHERE embedding IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 100
      )
      SELECT *,
        (similarity * (1 - $3::float) + (1 - recency_rank / 100.0) * $3::float) as final_score
      FROM scored
      ORDER BY final_score DESC
      LIMIT $2::integer
    `;

    const result = await this.client.query(query, [embeddingStr, Math.floor(topK), recencyWeight]);

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      embedding: row.embedding,
      keywords: row.keywords || [],
      metadata: row.metadata,
      createdAt: row.created_at,
      similarity: parseFloat(row.similarity),
      finalScore: parseFloat(row.final_score),
    }));
  }

  /**
   * Update keywords for the most recent conversation message
   * Used by Limbic agent to add emotional/semantic tags after interaction assessment
   */
  async updateConversationKeywords(
    sessionId: string,
    role: string,
    keywords: string[]
  ): Promise<void> {
    const query = `
      UPDATE conversation_history
      SET keywords = $1
      WHERE session_id = $2
        AND role = $3
        AND id = (
          SELECT id FROM conversation_history
          WHERE session_id = $2 AND role = $3
          ORDER BY created_at DESC
          LIMIT 1
        )
    `;

    await this.client.query(query, [keywords, sessionId, role]);
  }

  /**
   * Keyword-based search over conversation history
   * Returns messages that match any of the query keywords
   */
  async searchConversationHistoryByKeywords(
    queryKeywords: string[],
    topK: number = 10
  ): Promise<Array<ConversationMessage & { keywordScore: number }>> {
    // Search for messages where keywords array overlaps with query keywords
    const query = `
      SELECT *,
        COALESCE(array_length(keywords, 1), 0)::float as keyword_count,
        CASE
          WHEN keywords && $1::text[] THEN
            (SELECT COUNT(*) FROM unnest(keywords) k WHERE k = ANY($1::text[]))::float /
            GREATEST(array_length(keywords, 1), 1)::float
          ELSE 0.0
        END as keyword_score
      FROM conversation_history
      WHERE keywords && $1::text[]
        OR content ILIKE ANY($2::text[])
      ORDER BY keyword_score DESC, created_at DESC
      LIMIT $3::integer
    `;

    // Create ILIKE patterns for content matching
    const likePatterns = queryKeywords.map(kw => `%${kw}%`);

    const result = await this.client.query(query, [
      queryKeywords,
      likePatterns,
      Math.floor(topK)
    ]);

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      embedding: row.embedding,
      keywords: row.keywords || [],
      metadata: row.metadata,
      createdAt: row.created_at,
      keywordScore: parseFloat(row.keyword_score || 0),
    }));
  }

  /**
   * Hybrid search over conversation history (vector + keywords + entities)
   * Uses Reciprocal Rank Fusion (RRF) to combine results
   */
  async hybridSearchConversationHistory(
    queryEmbedding: number[],
    queryKeywords: string[],
    topK: number = 10,
    recencyWeight: number = 0.3,
    rrfK: number = 1
  ): Promise<Array<ConversationMessage & {
    similarity?: number;
    keywordScore?: number;
    finalScore: number;
    method: string;
  }>> {
    // Get vector search results
    const vectorResults = await this.searchConversationHistory(
      queryEmbedding,
      topK * 2, // Get more results for fusion
      recencyWeight
    );

    // Get keyword search results
    const keywordResults = await this.searchConversationHistoryByKeywords(
      queryKeywords,
      topK * 2
    );

    // Apply RRF fusion
    const rrfScores = new Map<number, {
      message: ConversationMessage;
      vectorRank?: number;
      keywordRank?: number;
      vectorScore?: number;
      keywordScore?: number;
      rrfScore: number;
    }>();

    // Add vector results to RRF map
    vectorResults.forEach((msg, index) => {
      const rank = index + 1;
      const rrfScore = 1 / (rrfK + rank);
      rrfScores.set(msg.id, {
        message: msg,
        vectorRank: rank,
        vectorScore: msg.similarity,
        rrfScore,
      });
    });

    // Add keyword results to RRF map
    keywordResults.forEach((msg, index) => {
      const rank = index + 1;
      const rrfScore = 1 / (rrfK + rank);

      if (rrfScores.has(msg.id)) {
        // Message appears in both - add RRF scores
        const existing = rrfScores.get(msg.id)!;
        existing.keywordRank = rank;
        existing.keywordScore = msg.keywordScore;
        existing.rrfScore += rrfScore;
      } else {
        // New message from keyword search
        rrfScores.set(msg.id, {
          message: msg,
          keywordRank: rank,
          keywordScore: msg.keywordScore,
          rrfScore,
        });
      }
    });

    // Sort by combined RRF score and take top K
    const sortedResults = Array.from(rrfScores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK);

    return sortedResults.map(item => ({
      ...item.message,
      similarity: item.vectorScore,
      keywordScore: item.keywordScore,
      finalScore: item.rrfScore,
      method: item.vectorRank && item.keywordRank ? "hybrid" :
        item.vectorRank ? "vector" : "keyword",
    }));
  }

  // ============================================================================
  // Task Rules (Procedural Memory)
  // ============================================================================

  /**
   * Create a new task rule
   */
  async createTaskRule(params: {
    ruleName: string;
    taskPatterns: string[];
    ruleContent: string;
    ruleType?: string;
    examples?: string[];
    embedding: number[];
    metadata?: Record<string, any>;
  }): Promise<number> {
    const result = await this.client.query(
      `INSERT INTO task_rules (rule_name, task_patterns, rule_content, rule_type, examples, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        params.ruleName,
        params.taskPatterns,
        params.ruleContent,
        params.ruleType || 'guideline',
        params.examples || [],
        `[${params.embedding.join(',')}]`,
        params.metadata || {}
      ]
    );
    return result.rows[0].id;
  }

  /**
   * Update an existing task rule
   */
  async updateTaskRule(params: {
    id: number;
    ruleName?: string;
    taskPatterns?: string[];
    ruleContent?: string;
    ruleType?: string;
    examples?: string[];
    embedding?: number[];
    metadata?: Record<string, any>;
  }): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.ruleName !== undefined) {
      updates.push(`rule_name = $${paramIndex++}`);
      values.push(params.ruleName);
    }
    if (params.taskPatterns !== undefined) {
      updates.push(`task_patterns = $${paramIndex++}`);
      values.push(params.taskPatterns);
    }
    if (params.ruleContent !== undefined) {
      updates.push(`rule_content = $${paramIndex++}`);
      values.push(params.ruleContent);
    }
    if (params.ruleType !== undefined) {
      updates.push(`rule_type = $${paramIndex++}`);
      values.push(params.ruleType);
    }
    if (params.examples !== undefined) {
      updates.push(`examples = $${paramIndex++}`);
      values.push(params.examples);
    }
    if (params.embedding !== undefined) {
      updates.push(`embedding = $${paramIndex++}`);
      values.push(`[${params.embedding.join(',')}]`);
    }
    if (params.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(params.metadata);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(params.id);

      await this.client.query(
        `UPDATE task_rules SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }
  }

  /**
   * Delete a task rule
   */
  async deleteTaskRule(id: number): Promise<void> {
    await this.client.query(`DELETE FROM task_rules WHERE id = $1`, [id]);
  }

  /**
   * Get a single task rule by ID
   */
  async getTaskRule(id: number): Promise<any | null> {
    const result = await this.client.query(
      `SELECT * FROM task_rules WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * List all task rules
   */
  async listTaskRules(ruleType?: string): Promise<any[]> {
    let query = `SELECT * FROM task_rules`;
    const params: any[] = [];

    if (ruleType) {
      query += ` WHERE rule_type = $1`;
      params.push(ruleType);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.client.query(query, params);
    return result.rows.map(row => ({
      id: row.id,
      ruleName: row.rule_name,
      taskPatterns: row.task_patterns,
      ruleContent: row.rule_content,
      ruleType: row.rule_type,
      examples: row.examples,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Search task rules by semantic similarity
   */
  async searchTaskRules(
    queryEmbedding: number[],
    topK: number = 5,
    minSimilarity: number = 0.5
  ): Promise<any[]> {
    const result = await this.client.query(
      `SELECT
        id,
        rule_name,
        task_patterns,
        rule_content,
        rule_type,
        examples,
        metadata,
        1 - (embedding <=> $1) as similarity,
        created_at,
        updated_at
      FROM task_rules
      WHERE (1 - (embedding <=> $1)) >= $2
      ORDER BY similarity DESC
      LIMIT $3`,
      [`[${queryEmbedding.join(',')}]`, minSimilarity, topK]
    );

    return result.rows.map(row => ({
      id: row.id,
      ruleName: row.rule_name,
      taskPatterns: row.task_patterns,
      ruleContent: row.rule_content,
      ruleType: row.rule_type,
      examples: row.examples,
      metadata: row.metadata,
      similarity: parseFloat(row.similarity),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  async close(): Promise<void> {
    await this.client.end();
    console.log("PostgreSQL connection closed");
  }

  async query(sql: string, params?: any[]): Promise<any> {
    return this.client.query(sql, params);
  }
}
