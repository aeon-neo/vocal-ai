# VocalAI

Socratic oral examination system for **Critical Thinking assessment**. Uses AI-powered questioning to evaluate student reasoning skills through natural conversation, with real-time behavioral analysis and comprehensive assessment reports.

**Purpose:** Conduct Socratic-style oral examinations that assess Critical Thinking skills (AO1: Analysis, AO2: Evaluation, AO3: Development) through questioning alone - the examiner never provides answers, only probing questions.

**Built with:** LangGraph, Node.js, TypeScript, PostgreSQL + pgvector, OpenAI GPT-4o, and Hume AI for voice.

## Architecture

**LangGraph State Machine** with 3-node Socratic examination flow:

```
Turn 0: Student -> Router -> ExamPrep -> Insula -> Student (topic/scenario presented)
Turn 1+: Student -> Router -> Cortex -> Insula -> Student (Socratic questioning)
```

### Graph Nodes

**Router** - Directs flow based on turn count

- Turn 0: Routes to ExamPrep (cultural assessment + scenario selection)
- Turn 1+: Routes to Cortex (Socratic examination)

**ExamPrep** (Exam Preparation) - OpenAI GPT-4o-mini

- Assesses student's cultural preferences (ethnicity, language, background)
- Searches RAG database for appropriate CT scenarios
- Generates topic introduction and scenario stimulus
- Scenario is displayed on screen; examiner speaks topic intro
- Sets up exam session with topic and scenario stored in database

**Cortex** (Socratic Examiner) - OpenAI GPT-4o

- Conducts oral examination using ONLY questions - never provides answers
- Receives the FULL scenario text to ensure questions are relevant
- Uses RAG to retrieve relevant specimen papers and marking schemes
- Probes student reasoning with follow-up questions
- Adapts question difficulty based on student responses
- Auto-ends exam after 3 question-answer exchanges (turn 3)

**Insula** (Safety and Compliance) - OpenAI GPT-4o-mini

- Ensures Socratic method compliance (blocks any answer-giving)
- Maintains educational boundaries
- Detects student distress or frustration
- Validates examination conduct

### Background Agents (Fire-and-Forget)

**Logic** (CT Assessor)

- Async assessment of each student response (does not block dialog)
- Scores against Cambridge A-Level CT criteria (AO1/AO2/AO3)
- Generates per-turn CT skill scores (0-100)
- Builds comprehensive transcript with assessments
- Generates final session report with grade recommendation

**Limbic** (Emotion Tracker)

- Tracks student emotional state (confidence, anxiety, engagement)
- Monitors fluency and body language via video analysis
- Observation only - does not influence examiner questions
- Stores emotional state per turn for reporting

## Examination Flow

```
Turn 0 (Setup):
  Student speaks cultural preferences -> ExamPrep assesses
  ExamPrep searches RAG for scenario -> Generates topic/scenario
  Scenario displayed on screen -> Examiner speaks topic intro
  Topic and scenario saved to database (exam_sessions table)

Turn 1+ (Examination):
  Student speaks -> Cortex reads scenario from state
  Cortex generates Socratic question about THE SCENARIO
  Question validated by Insula -> Student hears question
        |
        v (async, non-blocking)
  Logic scores CT skills (AO1/AO2/AO3)
  Limbic tracks emotions
  Both store results to database

Turn N (End):
  Cortex detects max turns reached
  Logic generates final report (grades, strengths, improvements)
  Report displayed to student
```

**Key Principles:**

- Examiner asks questions ONLY - never explains, never answers
- Questions MUST be about the specific scenario presented
- Student must demonstrate reasoning through their responses
- Assessment happens asynchronously (does not slow down conversation)
- Topic and scenario are persisted in database for session recovery

## Features

### Socratic Examination

- **Pure questioning approach**: Examiner uses clarifying questions, probing questions, and Socratic dialogue
- **Scenario-focused**: Questions are always about the specific scenario presented
- **RAG-powered content**: Scenarios retrieved from specimen papers and marking schemes
- **Cultural sensitivity**: Scenario selection considers student's cultural background
- **Auto-completion**: Exam ends after 3 question-answer exchanges with final assessment

### Critical Thinking Assessment (Cambridge A-Level)

- **AO1 - Analysing Arguments (20%)**: Identifying premises and conclusions
- **AO2 - Judging Relevance (20%)**: Identifying relevant information
- **AO2 - Evaluating Claims (20%)**: Evaluating claims, inferences, explanations
- **AO3 - Constructing Arguments (20%)**: Constructing clear, coherent arguments
- **AO3 - Forming Judgements (20%)**: Forming well-reasoned judgements

### Real-time Behavioral Analysis

- **Video emotion detection**: 7 basic emotions with confidence scores
- **Mood state tracking**: Anxious, relaxed, frustrated, excited, focused
- **Voice prosody analysis**: Emotional tone from speech patterns (Hume AI)
- **Time-based throttling**: One video analysis per 10 seconds (reduces API costs)

### Comprehensive Reporting

- **Full examination transcript**: Every student response and examiner question
- **Per-turn CT scores**: All 5 CT skill scores for each response
- **Grade recommendation**: Cambridge A-Level style (A\* to U)
- **Strengths and improvements**: Specific feedback areas
- **Emotional timeline**: Student emotional state throughout examination

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 13+ with pgvector extension
- OpenAI API key (get from platform.openai.com)
- Hume API key (optional, for voice emotion analysis and TTS - get from platform.hume.ai)

### Installation

```bash
# Clone and install
git clone <repository-url>
cd vocal-ai
npm install

# Set up PostgreSQL
sudo -u postgres psql -c "CREATE DATABASE vocal_ai_db;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'password';"
sudo -u postgres psql -d vocal_ai_db -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Configure environment (.env file)
OPENAI_API_KEY=sk-...
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=vocal_ai_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password

# Voice features for video chat
HUME_API_KEY=your-hume-api-key
WHISPER_PROVIDER=openai  # or "local" for free local transcription

# Initialize database
psql -h localhost -U postgres -d vocal_ai_db < database/install.sql

# Start server
npm run video-server
```

Server starts on http://localhost:5443

### Start Examination

Open http://localhost:5443/video-chat.html in your browser

1. Enable camera and microphone
2. Select voice preference (or "No voice" for text-only)
3. Click the green start button (wait for voice to initialize)
4. First, share your cultural background briefly
5. Read the scenario displayed on screen
6. Say "I'm ready" when ready to begin
7. Answer the examiner's questions thoroughly
8. Exam ends after 3 question-answer exchanges with final assessment

**Recording Controls:**

- Green record button: Click to start recording your response
- Red pulsing button: Recording in progress
- Button disabled while AI is speaking (wait for audio to finish)
- Click again to stop recording and send your response

## Usage

### Video Chat Examination

```bash
npm run video-server      # Start video exam server (port 5443)
# Then open http://localhost:5443/video-chat.html
```

Features:

- Real-time video and audio recording
- Emotion detection during responses
- Socratic questioning from AI examiner
- Voice synthesis for examiner responses (optional)
- Full transcript and assessment generation
- Live CT assessment scores in browser console (check Developer Tools)

### RAG Content Pipeline

Ingest specimen papers and marking schemes for RAG-powered scenarios.

**Document Location:** Place your PDF files in the project's `pdfs/` folder:

```
pdfs/
  specimen-papers/     # Cambridge CT specimen papers
  syllabus/            # Syllabus and marking schemes
```

**Pipeline Commands:**

```bash
# Step 1: Extract text from PDFs
npm run ingest-pdfs specimen-papers pdfs/specimen-papers
npm run ingest-pdfs syllabus pdfs/syllabus

# Step 2: Load into database
npm run seed-database specimen-papers
npm run seed-database syllabus

# Step 3: Chunk documents
npm run chunk specimen-papers
npm run chunk syllabus

# Step 4: Generate embeddings (add --analyze-docs for AI taxonomy analysis)
npm run vectorize specimen-papers -- --analyze-docs
npm run vectorize syllabus -- --analyze-docs

# Step 5: Test queries (optional)
npm run query specimen-papers
npm run query syllabus
npm run query                     # Query across all collections
```

## Development

### Available Commands

```bash
# Examination Server
npm run video-server      # Start video examination server

# Development
npm run lint              # Type-check
npm run build             # Compile TypeScript
npm run clean             # Remove compiled files
npm run verify-setup      # Verify environment

# RAG Pipeline
npm run ingest-pdfs <collection> <directory>
npm run seed-database <collection>
npm run chunk <collection>
npm run vectorize <collection>
npm run query [collection]
```

### Project Structure

```
src/
├── langgraph/                       # Multi-agent orchestration
│   ├── state.ts                     # Examination state (includes scenario)
│   └── graph.ts                     # 3-node examination flow
├── agents/                          # Agent implementations
│   ├── exam-prep.ts                 # Scenario selection and setup
│   ├── cortex.ts                    # Socratic examiner (questions only)
│   ├── insula.ts                    # Safety and Socratic compliance
│   ├── limbic.ts                    # Emotion tracking (observation only)
│   └── logic.ts                     # CT assessment (async scoring)
├── websocket/
│   ├── video-stream-server.ts       # Video examination server
│   ├── video-chat-service.ts        # Examination session handling
│   └── frame-processor.ts           # Behavioral analysis (10s throttle)
├── storage.ts                       # PostgreSQL client
├── vector-index.ts                  # RAG search
└── workflows/                       # RAG pipeline tools
```

### Database Schema

**Core Tables:**

- `exam_sessions` - Examination sessions with topic and scenario text
- `assessment_results` - Per-turn CT skill scores (5 skills, 0-100 each)
- `emotional_states` - Student emotional timeline per turn
- `conversation_history` - Full conversation transcripts
- `knowledge_documents` - Specimen papers and marking schemes
- `knowledge_embeddings` - Vector embeddings for RAG

**Key Columns in exam_sessions:**

```sql
id UUID PRIMARY KEY
student_name VARCHAR(255)
language VARCHAR(50)           -- Detected language
topic VARCHAR(255)             -- Topic name (e.g., "Urban Development")
scenario TEXT                  -- Full scenario text for Cortex to reference
status VARCHAR(50)             -- in_progress, completed, abandoned
turn_count INTEGER             -- Current turn in examination
```

## Technology Stack

- **Multi-Agent Framework**: LangGraph (StateGraph with conditional routing)
- **Backend**: Node.js 18+, TypeScript, Express
- **Database**: PostgreSQL 13+ with pgvector
- **AI Models**:
  - OpenAI GPT-4o (Cortex examiner, primary reasoning)
  - OpenAI GPT-4o-mini (ExamPrep, Insula, Logic, fast tasks)
  - Hume AI Octave (emotionally expressive TTS)
  - Hume AI Prosody (voice emotion analysis)
  - OpenAI Whisper (audio transcription)
- **Embeddings**: HuggingFace all-mpnet-base-v2 (768 dimensions)
- **Search**: Hybrid search with RRF fusion

## Critical Thinking Framework

Based on Cambridge International AS Level Thinking Skills (9694):

### AO1 - Analysis (20%)

- Identifying arguments and conclusions
- Recognizing assumptions and implications
- Breaking down complex reasoning

### AO2 - Evaluation (40%)

- Judging relevance of information
- Evaluating claims and inferences
- Assessing strength of arguments

### AO3 - Development (40%)

- Constructing counter-arguments
- Drawing valid conclusions
- Forming well-reasoned judgements

## Troubleshooting

### Database Connection

```bash
# Check PostgreSQL is running
sudo lsof -i :5432

# Test connection
psql -h localhost -U postgres -d vocal_ai_db -c "SELECT version();"

# Add scenario column if upgrading from older version
psql -h localhost -U postgres -d vocal_ai_db -c "ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS scenario TEXT;"
```

### Missing API Key

Ensure `OPENAI_API_KEY` is set in `.env`:

```
OPENAI_API_KEY=sk-...
```

### Video Chat Issues

- Enable camera/microphone permissions in browser
- Check WebSocket connection (port 5443)
- Verify Hume API key for voice features
- Wait for green button spinner to complete before speaking

### Questions Not Matching Topic

If the examiner asks questions about unrelated topics:

1. Check that `scenario` column exists in `exam_sessions` table
2. Verify ExamPrep is storing scenario in state
3. Confirm Cortex receives scenario in its context

## Deployment

For production deployment to Render.com (backend) and Vercel (frontend), see the comprehensive deployment guide:

[**DEPLOYMENT.md**](DEPLOYMENT.md)

The guide covers:
- Backend deployment to Render.com with PostgreSQL
- Frontend deployment to Vercel
- Environment variable configuration
- RAG document ingestion
- CORS setup for cross-origin WebSocket
- Troubleshooting common issues
- Cost estimates and optimization tips

---

Built for the EduX Hackathon - Socratic Critical Thinking Assessment System
