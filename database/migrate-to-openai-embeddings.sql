-- Migration: Switch from HuggingFace (768-dim) to OpenAI embeddings (1536-dim)
-- WARNING: This will delete all existing embeddings
-- You must re-run the vectorization workflow after running this migration

-- Step 1: Delete all existing embeddings
TRUNCATE TABLE knowledge_embeddings CASCADE;

-- Step 2: Drop the old embedding column
ALTER TABLE knowledge_embeddings DROP COLUMN IF EXISTS embedding;

-- Step 3: Add new embedding column with 1536 dimensions
ALTER TABLE knowledge_embeddings ADD COLUMN embedding vector(1536) NOT NULL DEFAULT array_fill(0, ARRAY[1536])::vector;

-- Step 4: Remove the default (it was just for migration)
ALTER TABLE knowledge_embeddings ALTER COLUMN embedding DROP DEFAULT;

-- Step 5: Update conversation_history table (optional - this table might be empty)
ALTER TABLE conversation_history DROP COLUMN IF EXISTS embedding;
ALTER TABLE conversation_history ADD COLUMN embedding vector(1536);

-- Step 6: Recreate indexes
REINDEX TABLE knowledge_embeddings;

-- Done! Now run the vectorization workflow:
-- npm run vectorize specimen-papers
-- npm run vectorize syllabus
