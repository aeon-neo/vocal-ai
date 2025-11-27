# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Style Guidelines

**Never use emojis in any files.** This includes:

- Code files (.ts, .js, .tsx, .jsx)
- Documentation files (.md)
- Configuration files
- README files
- Commit messages
- Any other project files

Use clear, professional language without emojis.

## Sudo Command Guidelines

When a command requires sudo privileges:

1. Output the command for the user to run manually
2. Explain why sudo is needed
3. Wait for the user to provide the output
4. Do NOT attempt to run sudo commands directly through the Bash tool

Example: Instead of running `sudo lsof -i :5432`, tell the user: "Please run `sudo lsof -i :5432` to check what's using port 5432 and provide the output."

## Project Overview

**VocalAI** - A Socratic oral examination system for Critical Thinking assessment. Built for the EduX Hackathon. Uses AI-powered questioning to evaluate student reasoning skills through natural conversation.

**Purpose:** Conduct Socratic-style oral examinations that assess Critical Thinking skills (AO1: Analysis, AO2: Evaluation, AO3: Development) through questioning alone - the examiner never provides answers, only probing questions.

**Core Features:**

- **Socratic Examination**: Cortex asks questions ONLY - never provides answers
- **RAG-Powered Content**: Questions informed by specimen papers and marking schemes
- **CT Assessment**: Logic agent scores responses against AO1/AO2/AO3 criteria
- **Emotion Tracking**: Limbic monitors student confidence, anxiety, engagement
- **Video Chat Interface**: Real-time examination with behavioral analysis

**Technology Stack:**

- **LLM Provider**: OpenAI (GPT-4o for primary, GPT-4o-mini for fast tasks)
- **Framework**: LangGraph for multi-agent orchestration
- **Database**: PostgreSQL + pgvector
- **Voice**: Hume AI (prosody analysis, Octave TTS)
- **Transcription**: OpenAI Whisper API or local Whisper model

## Agent Architecture (LangGraph)

**LangGraph State Machine (2 Nodes):**

- **Cortex** -> **Insula** -> END
- Only these two agents are in the LangGraph flow

**Agent Roles:**

**1. Cortex (Socratic Examiner) - OpenAI GPT-4o**

- Graph node - entry point for all student messages
- Conducts examination using ONLY questions
- Uses RAG to retrieve relevant specimen papers
- Adapts question difficulty based on responses
- NEVER provides answers or explanations

**2. Insula (Safety & Compliance) - OpenAI GPT-4o-mini**

- Graph node - validates response before sending to student
- Ensures Socratic method compliance (blocks answer-giving)
- Detects student distress or frustration
- Maintains educational boundaries

**3. Logic (CT Assessor) - OpenAI GPT-4o-mini**

- Method-invoked (async, after response sent)
- Scores each student response against AO1/AO2/AO3
- Generates per-turn CT skill assessments
- Builds comprehensive transcript with scores

**4. Limbic (Emotion Tracker) - OpenAI GPT-4o-mini**

- Method-invoked (async, observation only)
- Tracks student emotional state (confidence, anxiety)
- Monitors fluency and body language via video
- NO relationship tracking - purely observational
- Feeds context to examiner for adaptive questioning

**Execution Flow:**

1. Student message -> **Cortex** (graph node)
2. Cortex uses RAG to inform questioning
3. Cortex generates probing question -> **Insula** (graph node)
4. Insula validates Socratic compliance -> Student
5. Background (async, after response):
   - Logic.assessCTSkills()
   - Limbic.trackEmotions()

## Development Commands

### Core Commands

```bash
npm run lint               # Type-check without emitting files (tsc --noEmit)
npm run clean              # Remove compiled dist/ files
npm run verify-setup       # Environment verification (Node, PostgreSQL, pgvector)
npm run video-server       # Start video examination server (port 5443)
```

### Database Installation

```bash
# Create database
createdb vocal_ai_db

# Install complete schema
psql -h localhost -U postgres -d vocal_ai_db < database/install.sql

# Verify
psql -d vocal_ai_db -c "\dt"
```

### RAG Content Pipeline

Ingest specimen papers and marking schemes:

```bash
# Stage 1: Extract text from PDF documents
npm run ingest-pdfs <collection-name> <pdf-directory>

# Stage 2: Load extracted documents into PostgreSQL
npm run seed-database <collection-name>

# Stage 3: Chunk documents with token-aware splitting
npm run chunk <collection-name>

# Stage 4: Generate embeddings and store in PostgreSQL
npm run vectorize <collection-name>

# Stage 5: Test RAG queries
npm run query [collection-name]
```

## Key Components

### Agents (src/agents/)

- **cortex.ts**: Socratic examiner - questions only, uses RAG
- **insula.ts**: Safety & Socratic compliance validation
- **limbic.ts**: Student emotion tracking (observation only)
- **logic.ts**: CT assessment scoring (AO1, AO2, AO3)

### WebSocket (src/websocket/)

- **video-stream-server.ts**: Video examination server
- **video-chat-service.ts**: Session handling, invokes VocalAIGraph
- **frame-processor.ts**: Behavioral analysis from video frames

### RAG Pipeline (src/)

- **storage.ts**: PostgreSQL client with pgvector operations
- **vector-index.ts**: Embedding generation and hybrid search
- **hybrid-search.ts**: Vector + AI keyword ranking + RRF fusion
- **keyword-query-agent.ts**: AI-powered chunk ranking

### Workflows (src/workflows/)

- **video-server.ts**: Main entry point for examination server
- **ingest-pdfs.ts**: PDF text extraction
- **seed-database.ts**: Document loading
- **chunk.ts**: Token-aware chunking
- **vectorize.ts**: Embedding generation
- **query.ts**: Interactive RAG testing

## Environment Configuration

Required environment variables (.env file):

```bash
# Required for OpenAI LLM
OPENAI_API_KEY=sk-...

# PostgreSQL configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=vocal_ai_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password

# Optional: Voice features
HUME_API_KEY=your-hume-api-key
WHISPER_PROVIDER=openai  # or "local"
```

## Code Conventions

### OpenAI API Integration

All LLM calls use OpenAI SDK:

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  max_tokens: 5000,
  temperature: 0,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ],
});

const responseText = response.choices[0]?.message?.content || "";
```

For JSON responses:

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  response_format: { type: "json_object" },
  messages: [...]
});
```

### Socket Event Names

Video chat uses `examiner-*` prefixed events:

- `examiner-response`: Examiner's question to student
- `examiner-audio-chunk`: TTS audio streaming
- `examiner-audio-complete`: Audio stream finished

### TypeScript Configuration

- Target: ES2020, ESNext modules
- Strict mode enabled
- Output: ./dist/ directory
- skipLibCheck: true (for OpenAI SDK compatibility)

## Critical Thinking Framework

Based on Cambridge International AS Level Thinking Skills (9694):

### AO1 - Analysis (30%)

- Identifying arguments and conclusions
- Recognizing assumptions and implications
- Breaking down complex reasoning

### AO2 - Evaluation (40%)

- Assessing strength of arguments
- Identifying flaws and weaknesses
- Evaluating evidence and examples

### AO3 - Development (30%)

- Constructing counter-arguments
- Drawing valid conclusions
- Synthesizing multiple perspectives

## Project-Specific Guidelines

### Socratic Method Compliance

The examiner (Cortex) must NEVER:

- Provide direct answers
- Explain concepts
- Give hints or clues
- Confirm if student is right/wrong

The examiner ONLY:

- Asks clarifying questions
- Asks probing questions
- Asks follow-up questions
- Redirects with questions

### Embedding Dimensions

- HuggingFace all-mpnet-base-v2 produces 768-dimensional vectors
- Vector table column: `embedding vector(768)`

### Database Tables

Core tables for examination:

- `exam_sessions`: Examination sessions
- `exam_transcripts`: Full conversation transcripts
- `ct_assessments`: Per-turn CT scores
- `emotional_states`: Student emotional timeline
- `knowledge_documents`: Specimen papers
- `knowledge_embeddings`: Vector embeddings for RAG

## Resources

- **README.md**: Setup instructions and usage guide
- **database/install.sql**: Complete database schema
- **OpenAI API**: https://platform.openai.com/docs
- **LangGraph**: https://langchain-ai.github.io/langgraph/
- **pgvector**: https://github.com/pgvector/pgvector
