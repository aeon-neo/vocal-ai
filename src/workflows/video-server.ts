/**
 * Video Stream Server Startup Script
 *
 * Starts the WebSocket server with Vocal AI exam integration.
 * Includes video chat with voice transcription and Socratic examiner responses.
 *
 * Usage:
 *   npm run video-server
 *   npm run video-server -- --port 8080
 */

import { VideoStreamServer } from "../websocket/video-stream-server";
import { PostgresService } from "../storage";
import { VectorIndexService } from "../vector-index";
import { VocalAIGraph } from "../langgraph/graph";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("=== Vocal AI Video Exam Server ===\n");

  // Parse command line arguments
  const args = process.argv.slice(2);
  const portArg = args.find((arg) => arg.startsWith("--port"));
  const port = portArg ? parseInt(portArg.split("=")[1]) : 5443;

  try {
    console.log("Initializing Vocal AI services...\n");

    // Read OpenAI API key from environment
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // Initialize PostgreSQL
    const storage = new PostgresService({
      host: process.env.POSTGRES_HOST || "localhost",
      port: parseInt(process.env.POSTGRES_PORT || "5432"),
      database: process.env.POSTGRES_DB || "vocal_ai_db",
      user: process.env.POSTGRES_USER || "postgres",
      password: process.env.POSTGRES_PASSWORD || "",
      ssl: process.env.POSTGRES_HOST?.includes("render.com")
        ? { rejectUnauthorized: false }
        : false,
    });
    await storage.initialize();

    // Initialize vector service with OpenAI embeddings
    const vectorService = new VectorIndexService({
      storageService: storage,
      openaiApiKey,
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
    await vectorService.initialize();

    // Initialize Vocal AI exam graph
    console.log("Building Vocal AI examination graph...");
    const vocalAIGraph = new VocalAIGraph(
      storage,
      vectorService,
      process.env.OPENAI_API_KEY
    );
    await vocalAIGraph.initialize();

    console.log("Vocal AI graph initialized\n");

    // Read whisper configuration from environment
    const whisperProvider = (process.env.WHISPER_PROVIDER || "openai") as "openai" | "local";

    console.log(`Using ${whisperProvider} Whisper for transcription\n`);

    // Create and start WebSocket server with Vocal AI integration
    const corsOrigin = process.env.CORS_ORIGIN || "*"; // Allow all origins for development
    const server = new VideoStreamServer({
      port,
      corsOrigin,
      maxHttpBufferSize: 1e7, // 10MB for video frames
      openaiApiKey,
      vocalAIGraph, // Pass the graph for exam integration
      whisperProvider,
    });

    console.log(`Starting video exam server on port ${port}...\n`);
    server.start();

    console.log("\nServer ready!");
    console.log(`\nVocal AI Video Exam: http://localhost:${port}/video-chat.html`);
    console.log(`WebSocket endpoint: http://localhost:${port}\n`);
    console.log("\nPress Ctrl+C to stop the server.\n");

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n\nShutting down server...");
      server.stop();
      console.log("Server stopped. Goodbye!");
      process.exit(0);
    });
  } catch (error) {
    console.error("Fatal error initializing server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
