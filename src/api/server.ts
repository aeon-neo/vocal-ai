/**
 * Vocal AI API Server - Express REST API
 *
 * Socratic Critical Thinking Examination System.
 * Provides REST endpoints for video chat interface.
 *
 * Key Features:
 * - POST /api/exam/start - Start new exam session
 * - POST /api/exam/message - Send student message, receive Socratic question
 * - POST /api/exam/end - End exam and get report
 * - GET /api/exam/transcript - Get full exam transcript
 *
 * Run with: npm run api
 */

import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import * as dotenv from "dotenv";
import { PostgresService } from "../storage";
import { VectorIndexService } from "../vector-index";
import { VocalAIGraph } from "../langgraph/graph";

dotenv.config();

export interface AppServices {
  storageService: PostgresService;
  vectorService: VectorIndexService;
  vocalAIGraph: VocalAIGraph;
}

export async function createApp(): Promise<Express> {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  console.log("Initializing Vocal AI Examination System...");

  // Parse DATABASE_URL if provided
  let dbConfig;
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    dbConfig = {
      host: url.hostname,
      port: parseInt(url.port || "5432"),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: { rejectUnauthorized: false },
    };
  } else {
    dbConfig = {
      host: process.env.POSTGRES_HOST || "localhost",
      port: parseInt(process.env.POSTGRES_PORT || "5432"),
      database: process.env.POSTGRES_DB || "vocal_ai_db",
      user: process.env.POSTGRES_USER || "postgres",
      password: process.env.POSTGRES_PASSWORD || "password",
    };
  }

  // Initialize storage
  const storage = new PostgresService(dbConfig);
  await storage.initialize();
  console.log("Storage service connected");

  // Initialize vector service with OpenAI embeddings
  const vector = new VectorIndexService({
    storageService: storage,
    openaiApiKey: process.env.OPENAI_API_KEY,
    embeddingDimensions: 1536, // OpenAI text-embedding-3-small
    tableName: "knowledge_embeddings",
    hybridSearch: {
      topK: parseInt(process.env.SEARCH_TOP_K || "5"),
      vectorTopK: parseInt(process.env.SEARCH_VECTOR_TOP_K || "10"),
      keywordTopK: parseInt(process.env.SEARCH_KEYWORD_TOP_K || "10"),
      useRRF: true,
      rrfK: parseInt(process.env.SEARCH_RRF_K || "1"),
    },
  });
  await vector.initialize();
  console.log("Vector service initialized");

  // Initialize Vocal AI LangGraph system
  const vocalAIGraph = new VocalAIGraph(
    storage,
    vector,
    process.env.OPENAI_API_KEY
  );
  await vocalAIGraph.initialize();
  console.log("Vocal AI examination system initialized");

  // Start Exam Session
  app.post("/api/exam/start", async (req: Request, res: Response) => {
    try {
      const { studentName, language } = req.body;
      const session = await vocalAIGraph.startExamSession(studentName, language);

      res.json({
        success: true,
        sessionId: session.sessionId,
        language: session.language,
        message: "Exam session started. Ready for Socratic dialog.",
      });
    } catch (error) {
      console.error("Error starting exam:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to start exam",
      });
    }
  });

  // Send Student Message
  app.post("/api/exam/message", async (req: Request, res: Response) => {
    try {
      const {
        sessionId,
        message,
        conversationHistory,
        topic,
        turnCount,
        emotionalContext,
      } = req.body;

      if (!sessionId || !message) {
        return res.status(400).json({
          success: false,
          error: "sessionId and message are required",
        });
      }

      const result = await vocalAIGraph.invoke({
        studentMessage: message,
        sessionId,
        conversationHistory,
        topic,
        turnCount,
        emotionalContext,
      });

      res.json({
        success: true,
        response: result.response,
        turnCount: result.turnCount,
        executionLog: result.executionLog,
      });
    } catch (error) {
      console.error("Error processing message:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to process message",
      });
    }
  });

  // End Exam Session
  app.post("/api/exam/end", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: "sessionId is required",
        });
      }

      const report = await vocalAIGraph.endExamSession(sessionId);

      res.json({
        success: true,
        report,
      });
    } catch (error) {
      console.error("Error ending exam:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate report",
      });
    }
  });

  // Get Exam Transcript
  app.get("/api/exam/transcript/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const transcript = await vocalAIGraph.getExamTranscript(sessionId);

      res.json({
        success: true,
        transcript,
      });
    } catch (error) {
      console.error("Error getting transcript:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get transcript",
      });
    }
  });

  // Check if student needs support
  app.get("/api/exam/support/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const support = await vocalAIGraph.checkStudentSupport(sessionId);

      res.json({
        success: true,
        ...support,
      });
    } catch (error) {
      console.error("Error checking support:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to check support",
      });
    }
  });

  // Root endpoint
  app.get("/", (req: Request, res: Response) => {
    res.json({
      name: "Vocal AI",
      version: "1.0.0",
      status: "online",
      description: "Socratic Critical Thinking Examination System",
      endpoints: {
        startExam: "POST /api/exam/start",
        sendMessage: "POST /api/exam/message",
        endExam: "POST /api/exam/end",
        getTranscript: "GET /api/exam/transcript/:sessionId",
        checkSupport: "GET /api/exam/support/:sessionId",
      },
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: "Not Found",
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  });

  return app;
}

export async function startServer(port: number = 5442): Promise<void> {
  try {
    const app = await createApp();

    app.listen(port, () => {
      console.log("\nVocal AI - Socratic Examination System");
      console.log(`Port: ${port}`);
      console.log(`Local: http://localhost:${port}`);
      console.log("\nArchitecture:");
      console.log("  - Cortex: Socratic examiner (questions only)");
      console.log("  - Logic: CT skill assessment (async)");
      console.log("  - Limbic: Emotional state tracking (async)");
      console.log("  - Insula: Safety guardrails");
      console.log("\nEndpoints:");
      console.log("  POST /api/exam/start");
      console.log("  POST /api/exam/message");
      console.log("  POST /api/exam/end");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || "5442");
  startServer(port);
}
