# Niimi API Documentation

## Overview

Niimi is a single-user, locally-deployed AI assistant with LangGraph tool-calling architecture. **All interactions happen through conversation** - there is ONE primary endpoint (`POST /api/chat`) that handles everything through natural language.

### Architecture

- **LangGraph State Machine**: Simple 2-node flow (Cortex → Insula → END)
- **Tool-Calling**: Cortex has 52 tools for reading data and delegating actions
- **Single-User**: No authentication needed - deployed locally on your machine
- **Chat-First Design**: One endpoint handles everything through conversation

### Technology Stack

- **Multi-Agent Framework**: LangGraph with tool-calling architecture
- **Backend**: Node.js 18+, TypeScript, Express
- **Database**: PostgreSQL 13+ with pgvector extension
- **AI Models**: Claude Sonnet 4.5 (Cortex, Chrono), Claude Haiku (Insula, Limbic)
- **Embeddings**: HuggingFace all-mpnet-base-v2 (768 dimensions)

### Base URL

```
http://localhost:5442
```

---

## Quick Start

### CLI Chat (Recommended)

```bash
npm run chat              # Normal mode with greeting
npm run chat -- --verbose # Verbose mode with tool call logs
npm run chat -- --resume  # Continue previous conversation
```

Interactive multi-turn conversation with full execution visibility.

### HTTP API

```bash
curl -X POST http://localhost:5442/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello! My name is Alex and I love hiking."}
    ]
  }'
```

---

## Endpoints

### POST /api/chat

**The primary endpoint.** Send a message and Niimi handles everything automatically through tool-calling.

**What Happens:**

1. **Cortex** (tool-calling agent) receives message with 52 tools available
2. Cortex uses tools to:
   - Read data: `get_upcoming_events`, `search_memories`, `get_relationship_context`
   - Delegate writes: `delegate_calendar_action` → Chrono, `delegate_action` → Motor
3. Cortex generates response
4. **Insula** (safety agent) validates response before sending to user
5. **Background** (async, after response):
   - Logic extracts tasks and memories
   - Limbic observes interaction for relationship tracking

**Request Body:**

```json
{
  "messages": [
    {"role": "user", "content": "I need to prepare for my hiking trip next weekend"}
  ]
}
```

**Fields:**
- `messages` (array, required): Conversation history ending with user message
  - `role` (string): "user" or "assistant"
  - `content` (string): Message text
- `collectionId` (string|array, optional): Specific document collections to search (rarely needed)

**Response:**

```json
{
  "response": "I'll help you prepare for your hiking trip! Let me check your upcoming events and create a reminder...",
  "metadata": {
    "memoriesUsed": 3,
    "newMemoriesFormed": 2,
    "tasksExtracted": 1,
    "eventsExtracted": 0,
    "relationshipStrength": 2.45,
    "duration": 2341,
    "timing": {
      "total": 2341
    }
  },
  "sources": [
    {
      "title": "Hiking Guide 2024",
      "relevance": 0.87,
      "content": "Essential gear checklist for day hikes..."
    }
  ],
  "executionLog": [
    {
      "agent": "cortex",
      "action": "invoke_tool",
      "timestamp": "2025-11-22T10:00:00.123Z",
      "result": {"toolCalls": 2}
    },
    {
      "agent": "insula",
      "action": "safety_check",
      "timestamp": "2025-11-22T10:00:02.234Z",
      "result": {"safetyLevel": "safe"}
    }
  ]
}
```

**Response Fields:**
- `response` (string): Niimi's reply
- `metadata` (object): Information about what happened
  - `memoriesUsed` (number): Memories retrieved for context
  - `newMemoriesFormed` (number): New memories extracted (async, after response)
  - `tasksExtracted` (number): Tasks automatically created (async, after response)
  - `eventsExtracted` (number): Calendar events created (always 0 - events delegated to Chrono)
  - `relationshipStrength` (number): Current relationship metric (-∞ to +∞)
  - `duration` (number): Total processing time (ms)
- `sources` (array, optional): Knowledge base citations (if knowledge was used)
- `executionLog` (array): LangGraph agent execution flow

---

### GET /api/chat/history

Get conversation history for the primary session.

**Query Parameters:**
- `limit` (number, optional): Max messages to return (default: 50)

**Response:**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello!",
      "createdAt": "2025-11-22T10:00:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Hello! How can I help you today?",
      "createdAt": "2025-11-22T10:00:01.000Z"
    }
  ],
  "count": 2
}
```

---

### GET /api/chat/suggestions

Get proactive suggestions based on time, tasks, and patterns.

**Response:**

```json
{
  "suggestions": [
    "You have 2 tasks due today. Would you like to review them?",
    "Based on your patterns, this is your peak productivity time."
  ],
  "count": 2
}
```

---

### GET /api/chat/dashboard

Get overview dashboard with user profile, stats, and summaries.

**Response:**

```json
{
  "profile": {
    "name": "Alex",
    "timezone": "America/New_York",
    "preferences": {}
  },
  "relationshipState": {
    "relationshipStrength": 2.45,
    "interactionCount": 156,
    "recentTrend": "strengthening"
  },
  "memoryStats": {
    "totalMemories": 45,
    "byType": {
      "preference": 12,
      "fact": 15,
      "goal": 8,
      "event": 10
    }
  },
  "taskStats": {
    "total": 8,
    "pending": 5,
    "completed": 23
  },
  "upcomingTasks": [...],
  "recentMemories": [...]
}
```

---

### GET /

API health check and overview.

**Response:**

```json
{
  "name": "Niimi",
  "version": "3.0.0",
  "status": "online",
  "description": "LLM-driven multi-agent AI system",
  "endpoint": "POST /api/chat"
}
```

---

## How It Works

### Tool-Calling Flow

```
1. User sends message
2. Cortex (graph node) invokes Claude Sonnet 4.5 with 52 tools bound
3. Claude decides which tools to use based on context:
   - Read tools: get_upcoming_events, search_memories, get_relationship_context
   - Delegation tools: delegate_action (tasks), delegate_calendar_action (events)
4. Cortex executes tools and generates response
5. Insula (graph node) validates response for safety
6. Response sent to user (instant 2-3s)
7. Background (async, non-blocking):
   - Logic.extractTasks() and Logic.extractMemories()
   - Limbic.observeInteraction()
   - Motor processes delegated actions
```

### Automatic Features

**Memory Management** (Logic Agent):
- Extracts facts, preferences, goals from conversation (async)
- Semantic search with 768-dim embeddings
- Automatically consolidates similar memories
- 6 memory types: preference, fact, goal, event, emotion, relationship

**Task Management** (Motor Agent):
- Cortex delegates task operations via `delegate_action` tool
- Motor processes create/complete/delete operations asynchronously
- Tracks completion status in `action_queue` table
- User gets instant acknowledgment, action completes in background

**Calendar Management** (Chrono Agent):
- Cortex delegates calendar operations via `delegate_calendar_action` tool
- Chrono processes create/update/delete events asynchronously
- Supports natural language dates and British temporal phrases
- Conflict detection and timezone handling

**Knowledge Integration** (VectorIndexService):
- Hybrid RAG search (vector + AI keywords + RRF fusion)
- Cites sources automatically when using knowledge
- 768-dimensional semantic search across documents

**Relationship Evolution** (Limbic Agent):
- Continuous relationship strength metric (-∞ to +∞)
- Adapts communication style based on relationship state
- Tracks trust, depth, reciprocity, vulnerability
- Async observation after response sent

---

## Usage Examples

### Multi-Turn Conversation (JavaScript)

```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:5442';

async function chat() {
  const messages = [];

  // First message
  const msg1 = await axios.post(`${API_BASE}/api/chat`, {
    messages: [{ role: 'user', content: 'Hello! My name is Alex.' }]
  });

  messages.push(
    { role: 'user', content: 'Hello! My name is Alex.' },
    { role: 'assistant', content: msg1.data.response }
  );

  console.log('Niimi:', msg1.data.response);
  console.log('Memories formed:', msg1.data.metadata.newMemoriesFormed);

  // Second message (with history)
  messages.push({ role: 'user', content: 'What do you remember about me?' });

  const msg2 = await axios.post(`${API_BASE}/api/chat`, {
    messages
  });

  console.log('Niimi:', msg2.data.response);
  console.log('Memories used:', msg2.data.metadata.memoriesUsed);
}
```

### Python Example

```python
import requests

API_BASE = 'http://localhost:5442'

def send_message(messages):
    response = requests.post(f'{API_BASE}/api/chat', json={'messages': messages})
    return response.json()

# Start conversation
messages = [{'role': 'user', 'content': 'Hello! My name is Alex.'}]
result = send_message(messages)

print(f"Niimi: {result['response']}")
print(f"Memories: {result['metadata']['newMemoriesFormed']}")

# Continue conversation
messages.append({'role': 'assistant', 'content': result['response']})
messages.append({'role': 'user', 'content': 'Schedule a meeting tomorrow at 2pm'})

result = send_message(messages)
print(f"Niimi: {result['response']}")
print(f"Tasks: {result['metadata']['tasksExtracted']}")
```

---

## Error Handling

All errors follow this format:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "metadata": {
    "duration": 123
  }
}
```

**Common Status Codes:**
- `200`: Success
- `400`: Bad Request (missing/invalid messages)
- `500`: Internal Server Error

---

## Performance

**Typical Response Times:**
- Read operations (get events/tasks): 2-3s
- Write operations (create/update/delete): 2-3s (instant acknowledgment, background processing)
- Memory retrieval: <50ms
- RAG search: ~200-400ms
- Complete response: 2-3s typical

**Async Operations** (non-blocking, after response sent):
- Memory extraction
- Task extraction
- Limbic observation (relationship tracking)
- Motor action processing
- Chrono event processing

**Performance Improvement:**
- **Was**: 30-45s blocking (90+ with old multi-agent routing)
- **Now**: 2-3s instant responses
- **10-15x faster** perceived response time

---

## CLI Chat

For the best experience, use the interactive CLI:

```bash
npm run chat              # Normal mode
npm run chat -- --verbose # Show tool calls and metadata
npm run chat -- --resume  # Continue previous conversation
```

**Features:**
- Multi-turn conversation with history
- Animated spinner with elapsed time
- Metadata display (memories, tasks, relationship strength)
- Source citations from knowledge base
- Tool call logs (verbose mode)
- Type `exit` to quit

---

## Best Practices

1. **Include conversation history** in messages array for multi-turn dialogs
2. **Check executionLog** to understand which tools were called and why
3. **Monitor relationship strength** to see how the relationship evolves
4. **Review sources** to see which knowledge was used
5. **Natural language works best** - just talk naturally about tasks, events, and goals
6. **Use CLI for development** - better visibility into agent execution

---

## Support

- **Health check**: `GET /`
- **CLI chat**: `npm run chat`
- **API server**: `npm run api`
- **Verify setup**: `npm run verify-setup`

---

**Niimi** - Greek Goddess of Memory

LangGraph tool-calling system with brain-inspired architecture.
