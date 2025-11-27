-- VocalAI - Socratic Critical Thinking Examination System
-- Database Installation Script
--
-- This script creates the database schema for Vocal AI:
-- - RAG Knowledge Base (documents, embeddings, hybrid search)
-- - Exam Sessions (student assessment tracking)
-- - Student Emotional State (confidence, fluency tracking)
-- - Conversation History (exam dialog)
--
-- Run once on fresh PostgreSQL database:
--   createdb vocal_ai_db
--   psql -h localhost -U postgres -d vocal_ai_db < database/install.sql

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
COMMENT ON EXTENSION vector IS 'pgvector extension for vector similarity search';

-- =============================================================================
-- RAG KNOWLEDGE BASE
-- =============================================================================

-- Document Collections
CREATE TABLE IF NOT EXISTS document_collections (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  taxonomy JSONB,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE document_collections IS 'Collections of Critical Thinking materials for RAG';
COMMENT ON COLUMN document_collections.taxonomy IS 'AI-generated collection taxonomy: overview, topics, audience, suggested queries';

-- Knowledge Documents
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
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_collection ON knowledge_documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_hash ON knowledge_documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_taxonomy ON knowledge_documents USING GIN (ai_taxonomy);

COMMENT ON TABLE knowledge_documents IS 'CT specimen papers, marking schemes, and assessment materials';
COMMENT ON COLUMN knowledge_documents.ai_taxonomy IS 'AI-generated document taxonomy: type, topics, entities, tags, summary';

-- Knowledge Embeddings (768-dimensional vectors from all-mpnet-base-v2)
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id VARCHAR(255) PRIMARY KEY,
  document_id VARCHAR(255) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  collection_id VARCHAR(255) REFERENCES document_collections(id),
  content TEXT NOT NULL,
  contextual_content TEXT,
  embedding vector(1536) NOT NULL,
  keywords TEXT[],
  metadata JSONB,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_doc ON knowledge_embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_collection ON knowledge_embeddings(collection_id);

COMMENT ON TABLE knowledge_embeddings IS 'Vector embeddings for semantic search with contextual enhancement and AI keywords';
COMMENT ON COLUMN knowledge_embeddings.contextual_content IS 'Enhanced content with AI taxonomy keywords for richer embeddings';
COMMENT ON COLUMN knowledge_embeddings.keywords IS 'AI-extracted keywords for Tier 2 hybrid search ranking';

-- =============================================================================
-- EXAM SESSIONS
-- =============================================================================

-- Exam Session Tracking
CREATE TABLE IF NOT EXISTS exam_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name VARCHAR(255),
  language VARCHAR(50) DEFAULT 'en',
  topic VARCHAR(255),
  scenario TEXT,
  status VARCHAR(50) DEFAULT 'in_progress',
  turn_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_exam_sessions_status ON exam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_started ON exam_sessions(started_at DESC);

COMMENT ON TABLE exam_sessions IS 'Tracks individual exam sessions with students';
COMMENT ON COLUMN exam_sessions.status IS 'Status: in_progress, completed, abandoned';
COMMENT ON COLUMN exam_sessions.language IS 'Detected language for Socratic dialog';
COMMENT ON COLUMN exam_sessions.topic IS 'CT scenario topic name (e.g., Urban Development)';
COMMENT ON COLUMN exam_sessions.scenario IS 'Full scenario/stimulus text presented to student for analysis';

-- =============================================================================
-- ASSESSMENT RESULTS (Per-Turn CT Scores)
-- =============================================================================

-- Per-turn assessment by Logic agent
CREATE TABLE IF NOT EXISTS assessment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES exam_sessions(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  examiner_question TEXT,
  student_response TEXT,

  -- CT Skill scores (0-100)
  analysing_arguments INTEGER,
  judging_relevance INTEGER,
  evaluating_claims INTEGER,
  constructing_arguments INTEGER,
  forming_judgements INTEGER,

  -- Overall
  overall_score INTEGER,
  examiner_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_results_session ON assessment_results(session_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_turn ON assessment_results(session_id, turn_number);

COMMENT ON TABLE assessment_results IS 'Per-turn Critical Thinking skill assessment by Logic agent';
COMMENT ON COLUMN assessment_results.analysing_arguments IS 'AO1: Identifying premises leading to conclusions (0-100)';
COMMENT ON COLUMN assessment_results.judging_relevance IS 'AO2: Identifying relevant information and significance (0-100)';
COMMENT ON COLUMN assessment_results.evaluating_claims IS 'AO2: Evaluating claims, inferences, explanations (0-100)';
COMMENT ON COLUMN assessment_results.constructing_arguments IS 'AO3: Constructing clear, coherent arguments (0-100)';
COMMENT ON COLUMN assessment_results.forming_judgements IS 'AO3: Forming well-reasoned judgements (0-100)';

-- =============================================================================
-- STUDENT EMOTIONAL STATE (Per-Turn Emotion Tracking)
-- =============================================================================

-- Per-turn emotional state by Limbic agent
CREATE TABLE IF NOT EXISTS student_emotional_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES exam_sessions(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,

  -- Confidence assessment
  confidence_level VARCHAR(50),

  -- Detected emotions from Hume AI prosody
  detected_emotions JSONB,

  -- Speaking fluency
  fluency_assessment VARCHAR(50),

  -- Body language analysis (from video frames)
  body_language_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_emotional_state_session ON student_emotional_state(session_id);
CREATE INDEX IF NOT EXISTS idx_student_emotional_state_turn ON student_emotional_state(session_id, turn_number);

COMMENT ON TABLE student_emotional_state IS 'Per-turn student emotional state tracked by Limbic agent';
COMMENT ON COLUMN student_emotional_state.confidence_level IS 'Confidence: confident, hesitant, uncertain';
COMMENT ON COLUMN student_emotional_state.detected_emotions IS 'Hume AI prosody analysis results';
COMMENT ON COLUMN student_emotional_state.fluency_assessment IS 'Speaking fluency: fluent, moderate, struggling';

-- =============================================================================
-- CONVERSATION HISTORY (Exam Dialog)
-- =============================================================================

-- Conversation History
CREATE TABLE IF NOT EXISTS conversation_history (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  keywords TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_history_session_id ON conversation_history(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at ON conversation_history(created_at DESC);

COMMENT ON TABLE conversation_history IS 'Full Socratic dialog history for exam sessions';
COMMENT ON COLUMN conversation_history.role IS 'Role: user (student), assistant (examiner), system';
COMMENT ON COLUMN conversation_history.embedding IS '768-dimensional embedding for semantic search';

-- =============================================================================
-- ANALYTICS
-- =============================================================================

-- Q&A Log (analytics)
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

CREATE INDEX IF NOT EXISTS idx_qa_log_session ON qa_log(session_id);
CREATE INDEX IF NOT EXISTS idx_qa_log_created ON qa_log(created_at);

COMMENT ON TABLE qa_log IS 'Query and answer logging for analytics';

-- Usage Log (analytics)
CREATE TABLE IF NOT EXISTS usage_log (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_usage_log_session ON usage_log(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_created ON usage_log(created_at);

COMMENT ON TABLE usage_log IS 'Usage tracking for analytics';

-- =============================================================================
-- TRIGGERS & FUNCTIONS
-- =============================================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER trigger_document_collections_updated_at
  BEFORE UPDATE ON document_collections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_knowledge_documents_updated_at
  BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- VECTOR INDEXES (created after data is loaded)
-- =============================================================================

-- Note: Vector indexes will be created automatically by the application
-- when sufficient data exists (100+ vectors recommended for IVFFlat)
-- Uncomment these if you're loading data via this script:

-- CREATE INDEX IF NOT EXISTS knowledge_embeddings_vector_idx
--   ON knowledge_embeddings
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);

-- CREATE INDEX IF NOT EXISTS conversation_history_vector_idx
--   ON conversation_history
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);

-- =============================================================================
-- COMPLETION
-- =============================================================================

SELECT 'VocalAI database schema installed successfully.' AS status;
SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public';
