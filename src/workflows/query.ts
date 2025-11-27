import * as dotenv from "dotenv";
import * as readline from "readline";
import { PostgresService } from "../storage";
import { VectorIndexService } from "../vector-index";
import { CollectionAnalyzer } from "../collection-analyzer";
// Removed import - using inline prompt for demo workflow

dotenv.config();

async function runQueryDemo() {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.error(" Please set OPENAI_API_KEY in your .env file");
    process.exit(1);
  }

  console.log("\n RAG Query Demo");
  console.log("=".repeat(50));

  // Get command line arguments (collection is optional, --verbose flag supported)
  const args = process.argv.slice(2);
  console.log(`\n DEBUG: Command-line args received: ${JSON.stringify(args)}`);

  const verboseIndex = args.indexOf('--verbose');
  const verbose = verboseIndex !== -1;

  // Remove --verbose flag from args to get collection name
  const filteredArgs = args.filter(arg => arg !== '--verbose');
  const collectionName = filteredArgs[0]; // undefined if not provided
  const tableName = `knowledge_embeddings`; // All collections use the same table

  if (verbose) {
    console.log("\n Verbose mode ENABLED - will show detailed tier-by-tier scoring");
  } else {
    console.log("\n Verbose mode DISABLED");
    console.log(" To enable verbose output, use: npm run query -- --verbose");
    console.log(" (Note the double dash -- before --verbose)");
  }

  console.log("\n1. Setting up OpenAI Embeddings");
  console.log("-".repeat(30));

  console.log("Using OpenAI text-embedding-3-small (1536d)");

  // Setup OpenAI client directly (not through LlamaIndex)
  const OpenAI = await import("openai");
  const openai = new OpenAI.default({
    apiKey: openaiApiKey,
  });

  console.log("OpenAI GPT configured (direct SDK)");

  console.log("\n2. Initializing Storage Service");
  console.log("-".repeat(30));

  // Parse DATABASE_URL if provided (Render, Heroku, etc.)
  let dbConfig;
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    dbConfig = {
      host: url.hostname,
      port: parseInt(url.port || "5432"),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: { rejectUnauthorized: false }, // Required for Render/Heroku
    };
  } else {
    const host = process.env.POSTGRES_HOST || "localhost";
    dbConfig = {
      host,
      port: parseInt(process.env.POSTGRES_PORT || "5432"),
      database: process.env.POSTGRES_DB || "cwsb_db",
      user: process.env.POSTGRES_USER || "postgres",
      password: process.env.POSTGRES_PASSWORD || "password",
      ssl: host.includes("render.com") ? { rejectUnauthorized: false } : false,
    };
  }

  // Initialize storage service
  const storageService = new PostgresService(dbConfig);

  await storageService.initialize();

  // Check if embeddings exist
  // Note: getVectorStats method not implemented in PostgresService - skipping validation

  // Show available collections
  const collectionsResult = await storageService.query(
    `SELECT DISTINCT collection_id, COUNT(*) as vector_count
     FROM knowledge_embeddings
     WHERE collection_id IS NOT NULL
     GROUP BY collection_id
     ORDER BY collection_id`
  );

  console.log(`\nQuerying collection: ${tableName}`);
  if (collectionsResult.rows.length > 0) {
    console.log("\nAvailable collections:");
    collectionsResult.rows.forEach((row: any) => {
      const marker =
        row.collection_id === collectionName ? " (querying this one)" : "";
      console.log(`   • ${row.collection_id}: ${row.vector_count} vectors${marker}`);
    });
  }

  if (collectionName) {
    console.log(`\n Querying collection: "${collectionName}"`);
  } else {
    console.log(`\n Querying all collections`);
  }

  console.log("\n3. Initializing Vector Service");
  console.log("-".repeat(30));

  // Get search configuration from environment (or use defaults)
  const searchTopK = parseInt(process.env.SEARCH_TOP_K || "20");
  const searchVectorTopK = parseInt(process.env.SEARCH_VECTOR_TOP_K || "30");
  const searchKeywordTopK = parseInt(process.env.SEARCH_KEYWORD_TOP_K || "30");
  const searchRrfK = parseInt(process.env.SEARCH_RRF_K || "60"); // RRF constant (default 60)

  // Initialize vector service with OpenAI embeddings
  const vectorService = new VectorIndexService({
    storageService: storageService,
    openaiApiKey: openaiApiKey,
    embeddingDimensions: 1536, // OpenAI text-embedding-3-small
    tableName: tableName,
    hybridSearch: {
      topK: searchTopK,
      vectorTopK: searchVectorTopK,
      keywordTopK: searchKeywordTopK,
      useRRF: true,
      rrfK: searchRrfK,
    },
  });

  await vectorService.initialize();
  console.log("Vector service initialized with hybrid search (RRF)");

  console.log("\n4. Collection Information & Suggested Queries");
  console.log("-".repeat(30));

  // Store example queries for number shortcuts
  const exampleQueries: string[] = [];

  // Load collection taxonomy for suggested queries (if specific collection provided)
  if (collectionName) {
    try {
      const analyzer = new CollectionAnalyzer();
      const taxonomy = await analyzer.loadTaxonomy(
        storageService,
        collectionName
      );

      if (taxonomy) {
        console.log(`\n Collection Overview:`);
        console.log(`   ${taxonomy.overview}`);

        console.log(
          `\n Primary Topics: ${taxonomy.primaryTopics.slice(0, 5).join(", ")}`
        );
        console.log(
          ` Target Audience: ${taxonomy.targetAudience.slice(0, 3).join(", ")}`
        );

        console.log(`\n Try these example queries (type 1, 2, or 3 to use):`);
        console.log(`\n    Semantic Queries (Conceptual):`);
        const semanticQueries = taxonomy.suggestedQueries.semantic.slice(0, 1);
        semanticQueries.forEach((q, i) => {
          const num = exampleQueries.length + 1;
          exampleQueries.push(q);
          console.log(`     ${num}. "${q}"`);
        });

        console.log(`\n    Technical Queries (Specific):`);
        const technicalQueries = taxonomy.suggestedQueries.technical.slice(0, 1);
        technicalQueries.forEach((q, i) => {
          const num = exampleQueries.length + 1;
          exampleQueries.push(q);
          console.log(`     ${num}. "${q}"`);
        });

        console.log(`\n    Exploratory Queries (Discovery):`);
        const exploratoryQueries = taxonomy.suggestedQueries.exploratory.slice(0, 1);
        exploratoryQueries.forEach((q, i) => {
          const num = exampleQueries.length + 1;
          exampleQueries.push(q);
          console.log(`     ${num}. "${q}"`);
        });
      }
    } catch (error) {
      console.log(
        ` No taxonomy found - run vectorization with --analyze-docs to generate suggested queries`
      );
    }
  } else {
    // Generate cross-collection example queries from all taxonomies
    console.log(
      `\n Querying across all collections - generating example queries...`
    );

    try {
      // Get all collections with taxonomies from collection_taxonomies table
      const collectionsResult = await storageService.query(
        `SELECT collection_name as id, taxonomy_data as taxonomy FROM collection_taxonomies`
      );

      // Get all document taxonomies
      const documentsResult = await storageService.query(
        `SELECT ai_taxonomy FROM knowledge_documents WHERE ai_taxonomy IS NOT NULL`
      );

      const allQueries: string[] = [];

      // 1. Collect queries from collection taxonomies (AI-generated, high quality)
      collectionsResult.rows.forEach((row: any) => {
        if (row.taxonomy?.suggestedQueries) {
          const tax = row.taxonomy.suggestedQueries;
          if (tax.semantic) allQueries.push(...tax.semantic);
          if (tax.technical) allQueries.push(...tax.technical);
          if (tax.exploratory) allQueries.push(...tax.exploratory);
        }
      });

      // 2. Generate queries from document taxonomies (topics, tags, entities)
      if (documentsResult.rows.length > 0) {
        // Collect unique topics, tags, and entities across all documents
        const topics = new Set<string>();
        const tags = new Set<string>();
        const entities = new Set<string>();

        documentsResult.rows.forEach((row: any) => {
          const tax = row.ai_taxonomy;
          if (tax.mainTopics)
            tax.mainTopics.forEach((t: string) => topics.add(t));
          if (tax.tags) tax.tags.forEach((tag: string) => tags.add(tag));
          if (tax.keyEntities)
            tax.keyEntities.forEach((e: string) => entities.add(e));
        });

        // Generate specific queries from extracted metadata
        const topicsArray = Array.from(topics).slice(0, 3);
        const tagsArray = Array.from(tags).slice(0, 3);
        const entitiesArray = Array.from(entities).slice(0, 2);

        topicsArray.forEach((topic) => {
          allQueries.push(`What does the legislation say about ${topic}?`);
        });

        tagsArray.forEach((tag) => {
          allQueries.push(
            `What are the requirements for ${tag.replace(/-/g, " ")}?`
          );
        });

        entitiesArray.forEach((entity) => {
          allQueries.push(`What is the role of ${entity}?`);
        });
      }

      // Select 3 random queries
      if (allQueries.length >= 3) {
        const shuffled = allQueries.sort(() => 0.5 - Math.random());
        const selectedQueries = shuffled.slice(0, 3);

        console.log(
          `\n Try these example queries (type 1, 2, or 3 to use):`
        );
        selectedQueries.forEach((q, i) => {
          exampleQueries.push(q);
          console.log(`     ${i + 1}. "${q}"`);
        });
      } else {
        console.log(
          `\n No taxonomies found - run vectorization with --analyze-docs to generate suggested queries`
        );
      }
    } catch (error) {
      console.log(` Error generating queries: ${error}`);
    }
  }

  // RAG Query Function
  async function performRAGQuery(query: string, topK: number = searchTopK) {
    const startTime = Date.now();

    console.log(`\n Query: "${query}"`);

    console.log("-".repeat(30));

    // Generate AI progress message
    try {
      const progressPrompt = `Generate a brief, specific progress message (5-8 words) for this search query. Be direct and relevant to what's being searched.

Query: "${query}"

Examples:
- "Who is Joel?" → "Searching for information about Joel"
- "Can I deregister my child?" → "Searching school deregistration guidance"
- "What are home visit rules?" → "Searching home visit requirements"
- "Essex LA contact details" → "Searching Essex contact information"

Progress message:`;

      const progressResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 30,
        temperature: 0,
        messages: [{ role: "user", content: progressPrompt }],
      });

      const progressMessage = progressResponse.choices[0]?.message?.content?.trim()
        || "Searching knowledge base";

      console.log(` ${progressMessage}...`);
    } catch (error) {
      console.error(" Progress message generation failed:", error);
      console.log(` Searching knowledge base...`);
    }

    try {
      // Search for relevant vectors (optionally filtered by collection)
      const searchResults = await vectorService.search(query, topK, {
        collectionId: collectionName, // undefined if querying all collections
        verbose: verbose,
      });

      // Debug: Log what we got back in verbose mode
      if (verbose) {
        console.log(`\n DEBUG: searchResults type: ${typeof searchResults}, Array: ${Array.isArray(searchResults)}`);
        if (typeof searchResults === 'object' && !Array.isArray(searchResults)) {
          console.log(` DEBUG: searchResults keys: ${Object.keys(searchResults).join(', ')}`);
        }
      }

      // Handle verbose mode output
      if (verbose && searchResults.vectorResults) {
        console.log("\n VERBOSE MODE: Tier-by-Tier Search Results");
        console.log("=".repeat(60));
        console.log(`Configuration: vectorTopK=${searchVectorTopK}, keywordTopK=${searchKeywordTopK}, finalTopK=${searchTopK}`);
        console.log(`RRF k constant: ${searchRrfK} (higher k = less aggressive rank compression)`);
        console.log("=".repeat(60));

        // Tier 1: Vector Semantic Search
        console.log(`\n Tier 1: Vector Semantic Search (${searchResults.vectorResults.length} results)`);
        console.log("-".repeat(60));
        searchResults.vectorResults.forEach((result: any, idx: number) => {
          const chunkNum = result.chunk.metadata?.chunkIndex !== undefined
            ? `[chunk ${result.chunk.metadata.chunkIndex + 1}/${result.chunk.metadata.totalChunks}]`
            : '';
          console.log(`  ${idx + 1}. ${result.chunk.metadata?.title || 'Untitled'} ${chunkNum} - Score: ${result.vectorScore?.toFixed(4) || 'N/A'}`);
        });

        // Tier 2: AI Keyword Search
        console.log(`\n\n Tier 2: AI Keyword Search (${searchResults.keywordResults.length} results)`);
        console.log("-".repeat(60));
        if (searchResults.keywordResults.length === 0) {
          console.log("  No keyword results returned.");
          console.log("  Check console output above for the ACTUAL reason:");
          console.log("    - Look for 'Tier 2 (Keyword Search):' warnings");
          console.log("    - Look for 'Keyword query agent failed:' errors");
        } else {
          searchResults.keywordResults.forEach((result: any, idx: number) => {
            const chunkNum = result.chunk.metadata?.chunkIndex !== undefined
              ? `[chunk ${result.chunk.metadata.chunkIndex + 1}/${result.chunk.metadata.totalChunks}]`
              : '';
            const keywords = result.chunk.metadata?.keywords?.slice(0, 3).join(', ') || 'None';
            console.log(`  ${idx + 1}. ${result.chunk.metadata?.title || 'Untitled'} ${chunkNum} - Score: ${result.keywordScore?.toFixed(4) || 'N/A'} (${keywords})`);
          });
        }

        // Final RRF Combined Results
        console.log(`\n\n Final RRF Results (${searchResults.rrfResults.length} results)`);
        console.log("-".repeat(60));
        console.log("  Combines Tier 1 + Tier 2 using Reciprocal Rank Fusion");
        console.log("  This is the FINAL ranking\n");
        searchResults.rrfResults.forEach((result: any, idx: number) => {
          const chunkNum = result.chunk.metadata?.chunkIndex !== undefined
            ? `[chunk ${result.chunk.metadata.chunkIndex + 1}/${result.chunk.metadata.totalChunks}]`
            : '';
          console.log(`  ${idx + 1}. ${result.chunk.metadata?.title || 'Untitled'} ${chunkNum}`);
          console.log(`      RRF: ${result.combinedScore?.toFixed(4) || 'N/A'} | Vec: ${result.vectorScore?.toFixed(4) || '-'} | Key: ${result.keywordScore?.toFixed(4) || '-'}`);
        });

        console.log("\n" + "=".repeat(60));
      }

      // Use rrfResults from verbose mode, or searchResults directly in normal mode
      const finalSearchResults = verbose && searchResults.rrfResults
        ? searchResults.rrfResults
        : searchResults;

      if (finalSearchResults.length === 0) {
        return {
          response: "No relevant documents found for this query.",
          sources: [],
          duration: Date.now() - startTime,
        };
      }

      // Build context from all hybrid search results (RRF already scored and ranked them)
      const context = finalSearchResults
        .map((result: any, idx: number) => {
          const title = result.chunk.metadata?.title || "Untitled";
          const content = result.chunk.content;

          // Show hybrid search scores if available
          let scoreInfo = "";
          if (result.method === "hybrid") {
            const vectorScore = result.vectorScore
              ? result.vectorScore.toFixed(3)
              : "N/A";
            const keywordScore = result.keywordScore ? result.keywordScore.toFixed(3) : "N/A";
            const combinedScore = result.combinedScore
              ? result.combinedScore.toFixed(3)
              : "N/A";
            scoreInfo = ` (RRF: ${combinedScore}, Vector: ${vectorScore}, Keyword: ${keywordScore})`;
          } else {
            scoreInfo = result.score ? ` (score: ${result.score.toFixed(3)})` : "";
          }

          return `[Document ${idx + 1}] ${title}${scoreInfo}\n${content.substring(
            0,
            1200
          )}...`;
        })
        .join("\n\n");

      // Simple RAG system prompt for demo (core system uses vocal-ai-prompts.ts)
      const systemPrompt = `You are a helpful AI assistant. Use the following context from the knowledge base to answer questions accurately.

KNOWLEDGE BASE CONTEXT:
${context}

Answer based on the provided context. If the context doesn't contain relevant information, say so.`;

      // Get response from OpenAI using direct SDK
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 5000,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: query,
          },
        ],
      });

      const duration = Date.now() - startTime;

      // Extract text content from OpenAI SDK response
      const responseContent = response.choices[0]?.message?.content
        || "Unable to generate response.";

      return {
        response: responseContent,
        sources: finalSearchResults.map((result: any) => ({
          title: result.chunk.metadata?.title || "Untitled",
          score: result.score,
          vectorScore: result.vectorScore,
          keywordScore: result.keywordScore,
          taxonomyScore: result.taxonomyScore,
          combinedScore: result.combinedScore,
          method: result.method,
          url: result.chunk.metadata?.source || result.chunk.metadata?.url || "",
          chunkIndex: result.chunk.metadata?.chunkIndex,
          totalChunks: result.chunk.metadata?.totalChunks,
        })),
        duration,
      };
    } catch (error) {
      console.error(` Query error: ${error}`);
      return {
        response: `Error processing query: ${error}`,
        sources: [],
        duration: Date.now() - startTime,
      };
    }
  }

  console.log("\n5. Interactive Query Mode");
  console.log("-".repeat(30));
  console.log(" Type your questions (or 'exit' to quit)");
  if (exampleQueries.length > 0) {
    console.log(" (Shortcuts: Type 1, 2, or 3 to use example queries above)");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = async () => {
    const input = await new Promise<string>((resolve) => {
      rl.question("\nYour question: ", resolve);
    });

    if (input.toLowerCase() === "exit") {
      return false;
    }

    // Handle number shortcuts for example queries
    let question = input.trim();
    const numMatch = question.match(/^([123])$/);
    if (numMatch && exampleQueries.length > 0) {
      const num = parseInt(numMatch[1]);
      if (num >= 1 && num <= exampleQueries.length) {
        question = exampleQueries[num - 1];
        console.log(` Using example query #${num}: "${question}"`);
      }
    }

    const result = await performRAGQuery(question);

    console.log(`\nResponse time: ${result.duration}ms`);
    console.log(`\n Response:`);
    console.log(result.response);

    if (result.sources.length > 0) {
      // Deduplicate sources by document title
      const uniqueSources = new Map<string, typeof result.sources[0]>();
      result.sources.forEach((source: {
        title: string;
        score?: number;
        vectorScore?: number;
        keywordScore?: number;
        taxonomyScore?: number;
        combinedScore?: number;
        method?: string;
        url?: string;
        chunkIndex?: number;
        totalChunks?: number;
      }) => {
        const key = source.title;
        if (!uniqueSources.has(key)) {
          uniqueSources.set(key, source);
        }
      });

      console.log(`\n Sources (${uniqueSources.size} documents):`);
      Array.from(uniqueSources.values()).forEach((source, idx) => {
        console.log(`   ${idx + 1}. ${source.title}`);
      });
    }

    return true;
  };

  let continueAsking = true;
  while (continueAsking) {
    continueAsking = await askQuestion();
  }

  rl.close();
  await storageService.close();

  console.log("\nRAG Query Demo Complete!");
  console.log("=".repeat(50));
  if (collectionName) {
    console.log(`\n Key Takeaway: Successfully queried "${collectionName}" collection`);
  } else {
    console.log(`\n Key Takeaway: Successfully queried all collections`);
  }
  // Total vectors search count not available (vector stats disabled)
  console.log(
    `   Two-tier hybrid search (AI Keywords + Vectors) + 2-way RRF + Claude = powerful Q&A!`
  );
  console.log("=".repeat(50));

}

// Run the workflow (ESM entry point)
runQueryDemo().catch(console.error);