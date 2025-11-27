#!/usr/bin/env node

/**
 * Vectorization Demo
 *
 * Demonstrates the complete vectorization pipeline: storage service initialization,
 * vector embedding generation, and semantic search. This demo orchestrates both
 * the storage module (for PostgreSQL operations) and vector-index module
 * (for embedding generation and search coordination).
 *
 * Uses pre-chunked documents from the chunking demo.
 *
 * Prerequisites: Run chunk.ts first to create chunk cache
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

import { PostgresService } from "../storage";
import { CollectionAnalyzer } from "../collection-analyzer";
import { VectorIndexService } from "../vector-index";
import { ContextualChunker } from "../contextual-embeddings";
import { DocumentAnalyzer } from "../document-taxonomy";

dotenv.config();

async function runVectorizationDemo() {
  console.log("\n Vectorization Demo");
  console.log("=".repeat(50));

  // Get command line arguments
  const args = process.argv.slice(2);

  // Parse flags and options
  const analyzeDocsFlag = args.includes("--analyze-docs");
  const forceFlag = args.includes("--force");
  const schemaIndex = args.indexOf("--schema");
  const schema = schemaIndex !== -1 && schemaIndex + 1 < args.length
    ? args[schemaIndex + 1]
    : 'public';
  const cacheIdArg = args.filter(arg => !arg.startsWith("--"))[0];

  if (!cacheIdArg) {
    console.log(" Please provide a cache ID as an argument");
    console.log(' Usage: npm run vectorize "cache-id" [options]');
    console.log(' Example: npm run vectorize "metatron"');
    console.log(' Example: npm run vectorize "cwsb" -- --analyze-docs');
    console.log(' Example: npm run vectorize "climate-science" -- --schema learning --analyze-docs');
    console.log(' Example: npm run vectorize "national" -- --analyze-docs --force  # Force regenerate taxonomies');
    console.log("\n Options:");
    console.log("   --analyze-docs   : Run AI document taxonomy analysis (requires OpenAI API key)");
    console.log("   --force          : Force regenerate ALL taxonomies and keywords (even if they exist)");
    console.log("   --schema <name>  : PostgreSQL schema (default: public, use learning for educational content)");
    console.log("\n Available chunk caches:");

    // List available chunk files
    const chunksDir = "./files/chunks_cache";
    if (fs.existsSync(chunksDir)) {
      const files = fs
        .readdirSync(chunksDir)
        .filter((f) => f.endsWith("_chunks.json"));
      if (files.length > 0) {
        files.forEach((file) => {
          const cacheId = file.replace("_chunks.json", "");
          console.log(`   • "${cacheId}"`);
        });
      } else {
        console.log("   No chunk caches found. Run chunking demo first:");
        console.log('   npm run chunk "author-id"');
      }
    }
    console.log("=".repeat(50));
    process.exit(1);
  }

  const cacheId = cacheIdArg;
  const chunksFile = path.join("./files/chunks_cache", `${cacheId}_chunks.json`);

  if (!fs.existsSync(chunksFile)) {
    console.log(` No chunk cache found for "${cacheId}"`);
    console.log(" First run the chunking demo:");
    console.log(`   npm run chunk "${cacheId}"`);
    process.exit(1);
  }

  console.log("\nLoading Chunked Documents");
  console.log("-".repeat(30));

  const chunksData = JSON.parse(fs.readFileSync(chunksFile, "utf8"));
  console.log(`Loaded ${chunksData.totalChunks} chunks from cache`);
  console.log(` Source: ${chunksData.documentCount} original documents`);
  console.log(` Quality: ${chunksData.stats.qualityPercentage}% optimal size`);

  console.log("\nInitializing Storage Service (PostgreSQL + pgvector)");
  console.log("-".repeat(30));
  console.log(` Schema: ${schema}`);

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
      schema: schema,
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
      schema: schema,
    };
  }

  // Initialize storage service
  const storageService = new PostgresService(dbConfig);

  await storageService.initialize();

  console.log("\nConfiguring Vector Service (Embeddings + Search)");
  console.log("-".repeat(30));

  // Initialize vector service with OpenAI text-embedding-3-small (1536 dimensions)
  const vectorService = new VectorIndexService({
    storageService: storageService,
    openaiApiKey: process.env.OPENAI_API_KEY,
    embeddingDimensions: 1536, // OpenAI text-embedding-3-small
    tableName: "knowledge_embeddings", // Use unified table from schema
  });

  await vectorService.initialize();

  console.log("\nEnhancing Chunks with Contextual Content");
  console.log("-".repeat(30));

  // Create contextual chunker
  const contextualChunker = new ContextualChunker({});

  // Load document metadata (author, publication_date) for citations
  console.log("Loading document metadata for citations...");
  const metadataQuery = `
    SELECT id, author, publication_date
    FROM ${schema}.knowledge_documents
    WHERE collection_id = $1
  `;
  const metadataResult = await storageService.query(metadataQuery, [cacheId]);
  const documentMetadata = new Map<string, {author?: string, publicationDate?: string}>();
  metadataResult.rows.forEach((row: any) => {
    documentMetadata.set(row.id, {
      author: row.author,
      publicationDate: row.publication_date
    });
  });
  console.log(`Loaded metadata for ${documentMetadata.size} documents`);

  // Transform chunks to format expected by contextual chunker
  // Note: collectionId passed via cacheId argument, not metadata (stored in collection_id column)
  const chunksForEnhancement = chunksData.chunks.map((chunk: any) => {
    const docId = chunk.metadata.documentId;
    const docMeta = documentMetadata.get(docId);

    return {
      id: chunk.id,
      text: chunk.text,
      metadata: {
        source: chunk.metadata.fileName,
        title: chunk.metadata.title,
        author: docMeta?.author,
        publicationDate: docMeta?.publicationDate,
        chunkIndex: chunk.metadata.chunkIndex,
        totalChunks: chunk.metadata.totalChunks,
        documentId: chunk.metadata.documentId,
        hash: chunk.metadata.hash,
        tokenCount: chunk.metadata.tokenCount,
      }
    };
  });

  // Load document taxonomies for contextual embeddings
  console.log("Loading document taxonomies for contextual content...");
  const taxonomyQuery = `
    SELECT id, ai_taxonomy
    FROM ${schema}.knowledge_documents
    WHERE collection_id = $1 AND ai_taxonomy IS NOT NULL
  `;
  const taxonomyResult = await storageService.query(taxonomyQuery, [cacheId]);
  const documentTaxonomies = new Map<string, any>();
  taxonomyResult.rows.forEach((row: any) => {
    documentTaxonomies.set(row.id, row.ai_taxonomy);
  });
  console.log(`Loaded ${documentTaxonomies.size} document taxonomies`);

  // Enhance chunks with contextual content from document taxonomies
  const enhancedChunks = await contextualChunker.enhanceChunks(chunksForEnhancement, documentTaxonomies);
  console.log(`Enhanced ${enhancedChunks.length} chunks with taxonomy-based contextual content`);

  console.log("\nIncremental Vector Update");
  console.log("-".repeat(30));

  // Load existing vectors from database for this collection only
  const existingVectors = await (storageService as any).getAllKnowledgeVectors({ collectionId: cacheId });
  console.log(`Found ${existingVectors.length} existing vectors in database for collection: ${cacheId}`);

  // Build a map of existing vectors by chunk hash for fast lookup
  const existingByHash = new Map<string, any>();
  existingVectors.forEach((vector: any) => {
    const hash = vector.metadata?.hash;
    if (hash) {
      existingByHash.set(hash, vector);
    }
  });

  // Categorize chunks: new, changed, or unchanged
  const newChunks: any[] = [];
  const unchangedChunkIds = new Set<string>();
  const currentHashes = new Set<string>();

  for (const chunk of enhancedChunks) {
    const hash = chunk.metadata.hash;
    currentHashes.add(hash);

    if (existingByHash.has(hash)) {
      // Chunk unchanged - keep existing vector
      unchangedChunkIds.add(chunk.id);
    } else {
      // New or changed chunk - needs new embedding
      newChunks.push(chunk);
    }
  }

  // Find deleted chunks (in DB but not in current chunks)
  const deletedChunkIds: string[] = [];
  existingVectors.forEach((vector: any) => {
    const hash = vector.metadata?.hash;
    if (hash && !currentHashes.has(hash)) {
      deletedChunkIds.push(vector.id);
    }
  });

  console.log(`\nChanges detected:`);
  console.log(`  Unchanged: ${unchangedChunkIds.size} chunks (will keep)`);
  console.log(`  New/Changed: ${newChunks.length} chunks (will generate embeddings)`);
  console.log(`  Deleted: ${deletedChunkIds.length} chunks (will remove)`);

  // Delete vectors for removed chunks (except system-protected data)
  if (deletedChunkIds.length > 0) {
    console.log(`\nRemoving ${deletedChunkIds.length} deleted chunks...`);
    for (const id of deletedChunkIds) {
      await storageService.query(
        `DELETE FROM knowledge_embeddings WHERE id = $1 AND is_system = FALSE`,
        [id]
      );
    }
  }

  // Extract AI keywords for new/changed chunks (or ALL chunks if --force)
  let chunkKeywords = new Map<string, string[]>();
  const chunksToExtractKeywords = forceFlag ? enhancedChunks : newChunks;

  if (chunksToExtractKeywords.length > 0) {
    if (forceFlag) {
      console.log(`\n--force flag: Regenerating keywords for ALL ${enhancedChunks.length} chunks...`);
    } else {
      console.log(`\nExtracting AI keywords for ${newChunks.length} chunks...`);
    }

    const { ChunkKeywordExtractor } = await import("../chunk-keyword-extractor");
    const keywordExtractor = new ChunkKeywordExtractor();

    const chunksForKeywordExtraction = chunksToExtractKeywords.map((chunk: any) => {
      const documentId = chunk.metadata?.documentId;
      const docTaxonomy = documentId && documentTaxonomies.has(documentId)
        ? documentTaxonomies.get(documentId)
        : null;

      return {
        id: chunk.id,
        text: chunk.text,
        title: chunk.metadata?.title,
        fileName: chunk.metadata?.source, // 'source' contains the filename
        documentTaxonomy: docTaxonomy,
      };
    });

    chunkKeywords = await keywordExtractor.extractKeywordsForChunks(
      chunksForKeywordExtraction,
      cacheId.replace(/-/g, ' ') // Convert "east-sussex" to "east sussex"
    );
    console.log(`Extracted keywords for ${chunkKeywords.size} chunks`);
  }

  // Generate embeddings only for new/changed chunks
  let newVectors: any[] = [];
  if (newChunks.length > 0) {
    console.log(`\nGenerating embeddings for ${newChunks.length} new/changed chunks...`);
    console.time("Vector creation time");
    newVectors = await vectorService.generateEmbeddings(newChunks);
    console.timeEnd("Vector creation time");
    console.log(`Generated ${newVectors.length} new embeddings`);

    // Add keywords to vectors
    newVectors = newVectors.map((vector: any) => ({
      ...vector,
      keywords: chunkKeywords.get(vector.id) || [cacheId.replace(/-/g, ' ')],
    }));
  } else {
    console.log(`\nNo new or changed chunks - skipping embedding generation`);
  }

  // Combine: keep existing unchanged vectors + add new vectors
  // If --force, update existing vectors with regenerated keywords
  let allVectors;
  if (forceFlag && chunkKeywords.size > 0) {
    console.log(`\n--force flag: Updating existing vectors with regenerated keywords...`);
    const updatedExistingVectors = existingVectors
      .filter((v: any) => unchangedChunkIds.has(v.id))
      .map((v: any) => ({
        ...v,
        keywords: chunkKeywords.get(v.id) || v.keywords || [cacheId.replace(/-/g, ' ')]
      }));
    allVectors = [...updatedExistingVectors, ...newVectors];
    console.log(`Updated ${updatedExistingVectors.length} existing vectors with new keywords`);
  } else {
    allVectors = [
      ...existingVectors.filter((v: any) => unchangedChunkIds.has(v.id)),
      ...newVectors
    ];
  }

  console.log(`\nTotal vectors: ${allVectors.length} (${unchangedChunkIds.size} kept + ${newVectors.length} new)`);

  // Save ALL vectors (unchanged + new) to local cache for analysis/backup
  console.log("\nSaving Vectors Locally");
  console.log("-".repeat(30));

  const vectorCacheDir = "./files/vectors_cache";
  if (!fs.existsSync(vectorCacheDir)) {
    fs.mkdirSync(vectorCacheDir, { recursive: true });
  }

  const vectorCacheFile = path.join(vectorCacheDir, `${cacheId}_vectors.json`);
  const vectorData: any = {
    collectionId: cacheId,
    tableName: "knowledge_embeddings",
    embeddingModel: "text-embedding-3-small",
    totalVectors: allVectors.length,
    dimensions: 1536, // OpenAI text-embedding-3-small produces 1536-dimensional vectors
    tokenLimit: 8191, // Max input tokens for text-embedding-3-small
    createdAt: new Date().toISOString(),
    vectors: allVectors, // All vectors (unchanged + new)
    taxonomy: null, // Will be populated if analysis succeeds
  };

  fs.writeFileSync(vectorCacheFile, JSON.stringify(vectorData, null, 2));
  console.log(`Saved ${allVectors.length} vectors to: ${vectorCacheFile}`);

  console.log("\nStoring Vectors in Database");
  console.log("-".repeat(30));

  // Store vectors in database
  // If --force is used with keyword regeneration, store ALL vectors (to update keywords)
  // Otherwise, store only NEW vectors (unchanged ones already in database)
  if (forceFlag && chunkKeywords.size > 0 && allVectors.length > 0) {
    console.log("--force flag: Updating ALL vectors in database with regenerated keywords...");
    await (storageService as any).storeKnowledgeVectors(allVectors, cacheId);
    console.log(`Stored ${allVectors.length} vectors (all updated with new keywords)`);
  } else if (newVectors.length > 0) {
    await (storageService as any).storeKnowledgeVectors(newVectors, cacheId);
    console.log(`Stored ${newVectors.length} new vectors in knowledge_embeddings table`);
  } else {
    console.log("No new vectors to store (all unchanged)");
  }

  // AI Document & Collection Taxonomy Analysis (requires --analyze-docs flag)
  if (analyzeDocsFlag) {
    console.log("\nAI Document Taxonomy Analysis (--analyze-docs)");
    console.log("=".repeat(50));

    // Get documents to analyze (incremental unless --force)
    let docsToAnalyze;
    if (forceFlag) {
      console.log("--force flag detected: Regenerating ALL taxonomies");
      const allDocsQuery = `
        SELECT id, title, content, file_name as "fileName"
        FROM knowledge_documents
        WHERE collection_id = $1
        LIMIT 100
      `;
      const allDocsResult = await storageService.query(allDocsQuery, [cacheId]);
      docsToAnalyze = allDocsResult.rows;
      console.log(`Found ${docsToAnalyze.length} documents (limit 100)`);
    } else {
      docsToAnalyze = await (storageService as any).getDocumentsWithoutTaxonomy(cacheId, 100);
    }

    if (docsToAnalyze.length === 0 && !forceFlag) {
      console.log("All documents already have AI taxonomy. Skipping analysis.");
    } else {
      console.log(`Found ${docsToAnalyze.length} documents to analyze`);

      // Initialize document analyzer
      const docAnalyzer = new DocumentAnalyzer();

      // Analyze each document
      const taxonomies = await docAnalyzer.analyzeDocuments(
        docsToAnalyze.map((doc: any) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          fileName: doc.fileName,
        })),
        (current, total) => {
          console.log(`  Progress: ${current}/${total} documents analyzed`);
        }
      );

      // Store taxonomies in database
      console.log("\nStoring document taxonomies...");
      for (const [docId, taxonomy] of taxonomies.entries()) {
        await storageService.updateDocumentTaxonomy(docId, taxonomy);
      }
      console.log(`Stored ${taxonomies.size} document taxonomies`);

      // Generate analysis report
      const analysisReport = docAnalyzer.generateAnalysisReport(taxonomies);
      const docReportsDir = "./docs/document-reports";
      if (!fs.existsSync(docReportsDir)) {
        fs.mkdirSync(docReportsDir, { recursive: true });
      }

      const docReportPath = path.join(docReportsDir, `${cacheId}-document-taxonomy.md`);
      fs.writeFileSync(docReportPath, analysisReport);

      console.log(`\nDocument taxonomy analysis complete!`);
      console.log(`Report saved to: ${docReportPath}`);
      console.log(`Taxonomy stored in knowledge_documents.ai_taxonomy column`);
    }

    // Now generate collection taxonomy (depends on document taxonomies)
    console.log("\nGenerating Collection Analysis & Taxonomy");
    console.log("-".repeat(30));

    const analyzer = new CollectionAnalyzer();
    console.log("Analyzing collection content and generating taxonomy...");

    const taxonomy = await analyzer.analyzeCollection(
      storageService,
      "knowledge_embeddings", // Table name
      cacheId, // Collection ID for filtering
      50 // Sample up to 50 documents for analysis
    );

    // Save taxonomy to database
    await analyzer.saveTaxonomy(storageService, cacheId, taxonomy);

    // Generate and save taxonomy report
    const taxonomyReport = analyzer.generateTaxonomyReport(taxonomy);
    const reportsDir = "./docs/collection-reports";
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = path.join(reportsDir, `${cacheId}-taxonomy.md`);
    fs.writeFileSync(reportPath, taxonomyReport);

    console.log(`Collection analysis complete!`);
    console.log(
      `Primary Topics: ${taxonomy.primaryTopics.slice(0, 3).join(", ")}`
    );
    console.log(
      `Target Audience: ${taxonomy.targetAudience.slice(0, 2).join(", ")}`
    );
    console.log(`Report saved to: ${reportPath}`);
    console.log(`Taxonomy saved to database for query suggestions`);

    // Add taxonomy info to vector cache
    vectorData.taxonomy = taxonomy;
    fs.writeFileSync(vectorCacheFile, JSON.stringify(vectorData, null, 2));
  } else {
    console.log("\nSkipping taxonomy analysis (use --analyze-docs to enable)");
  }

  console.log("\nVectorization Complete!");
  console.log("=".repeat(50));
  console.log(
    `\n Summary: ${newVectors.length > 0 ? `Generated and stored ${newVectors.length} new/changed embeddings` : 'All embeddings up to date (no changes detected)'}`
  );
  console.log(`    Total vectors: ${allVectors.length} (${unchangedChunkIds.size} unchanged + ${newVectors.length} new)`);
  console.log(`    Database: knowledge_embeddings table in PostgreSQL`);
  console.log(`    Cache: ${vectorCacheFile}`);
  if (analyzeDocsFlag) {
    console.log(`    Collection Analysis: ./docs/collection-reports/${cacheId}-taxonomy.md`);
    console.log(`    Document Taxonomy: ./docs/document-reports/${cacheId}-document-taxonomy.md`);
  }
  console.log(`    Ready for querying with npm run query ${cacheId}`);
  console.log("=".repeat(50));

  await storageService.close();

}

// Run the workflow (ESM entry point)
runVectorizationDemo().catch((error) => {
  console.error("\n=== VECTORIZATION FAILED ===");
  console.error("Error:", error);
  if (error instanceof Error && error.stack) {
    console.error("\nStack trace:");
    console.error(error.stack);
  }
  console.error("=".repeat(50));
  process.exit(1);
});

export { runVectorizationDemo };

