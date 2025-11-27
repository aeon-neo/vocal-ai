import * as dotenv from "dotenv";
import { PDFExtractor } from "../pdf-extractor";
import { DocumentManager } from "../document-manager";
import { PostgresService } from "../storage";
import { KnowledgeDocument } from "../lib/types";

dotenv.config();

/**
 * Database Seeding Workflow
 * Loads extracted PDF documents from cache into PostgreSQL database
 *
 * Usage:
 *   npm run seed-database <collection-id> [options]
 *
 * Arguments:
 *   collection-id    - Collection identifier (must match ingest-pdfs collection)
 *
 * Options:
 *   --replace        - Replace/update existing documents (default: skips existing)
 *   --schema <name>  - PostgreSQL schema (default: public, use learning for educational content)
 *
 * Examples:
 *   npm run seed-database cwsb-bill
 *   npm run seed-database cwsb-bill -- --replace
 *   npm run seed-database climate-science -- --schema learning
 */

interface SeedOptions {
  collectionId: string;
  replace: boolean;
  schema: string;
}

function parseArguments(): SeedOptions {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("\nERROR: Error: Missing required argument\n");
    console.log("Usage: npm run seed-database <collection-id> [options]\n");
    console.log("Arguments:");
    console.log("  collection-id    - Collection identifier\n");
    console.log("Options:");
    console.log("  --replace        - Replace/update existing documents (default: skips)");
    console.log("  --schema <name>  - PostgreSQL schema (default: public)\n");
    console.log("Examples:");
    console.log('  npm run seed-database cwsb-bill');
    console.log('  npm run seed-database cwsb-bill -- --replace');
    console.log('  npm run seed-database climate-science -- --schema learning');
    process.exit(1);
  }

  const options: SeedOptions = {
    collectionId: args[0],
    replace: false,
    schema: 'public',
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--replace') {
      options.replace = true;
    } else if (args[i] === '--schema' && i + 1 < args.length) {
      options.schema = args[i + 1];
      i++; // Skip next arg since we consumed it
    }
  }

  return options;
}

async function runDatabaseSeeding() {
  console.log("\n Database Seeding Workflow");
  console.log("=".repeat(60));

  const options = parseArguments();

  console.log("\nConfiguration:");
  console.log(`  Collection ID:   ${options.collectionId}`);
  console.log(`  Schema:          ${options.schema}`);
  console.log(`  Replace mode:    ${options.replace ? 'Yes (update existing)' : 'No (skip existing)'}`);

  console.log("\n1. Initializing Services");
  console.log("-".repeat(60));

  const pdfExtractor = new PDFExtractor();
  const docManager = new DocumentManager();

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
      schema: options.schema,
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
      schema: options.schema,
    };
  }

  const storage = new PostgresService(dbConfig);

  console.log("PDF extractor initialized");
  console.log("Document manager initialized");
  console.log("Storage service initialized");

  console.log("\n2. Loading Cached Documents");
  console.log("-".repeat(60));

  const cacheResult = await pdfExtractor.loadCachedDocuments(options.collectionId);

  if (!cacheResult.found) {
    console.log(`\nERROR: No cached documents found for collection: ${options.collectionId}`);
    console.log("\n   First run PDF ingestion:");
    console.log(`   npm run ingest-pdfs ${options.collectionId} <pdf-directory>\n`);
    process.exit(1);
  }

  const pdfDocuments = cacheResult.documents;
  console.log(`Loaded ${pdfDocuments.length} documents from cache`);
  console.log(`  Cache created: ${new Date(cacheResult.metadata.lastUpdated).toLocaleString()}`);

  console.log("\n3. Loading Collection Metadata");
  console.log("-".repeat(60));

  const collection = docManager.getCollection(options.collectionId);

  if (!collection) {
    console.log(`\nERROR: Collection not found: ${options.collectionId}`);
    console.log("   This should have been created during ingest-pdfs\n");
    process.exit(1);
  }

  console.log(`Collection: ${collection.name}`);
  console.log(`  ID: ${collection.id}`);
  if (collection.taxonomy) {
    console.log(`  Taxonomy: Present (AI-generated)`);
  }

  console.log("\n4. Connecting to Database");
  console.log("-".repeat(60));

  await storage.initialize();

  console.log("Connected to PostgreSQL");
  console.log(`  Database: ${process.env.POSTGRES_DB || 'cwsb_db'}`);

  console.log("\n5. Storing Collection");
  console.log("-".repeat(60));

  await storage.storeCollection({
    id: collection.id,
    name: collection.name,
    taxonomy: collection.taxonomy,
  });

  console.log(`Collection stored: ${collection.name}`);

  console.log("\n6. Converting Documents to Knowledge Format");
  console.log("-".repeat(60));

  const knowledgeDocuments: KnowledgeDocument[] = pdfDocuments.map((doc) => ({
    id: doc.id,
    fileHash: doc.metadata.hash,
    fileName: doc.metadata.fileName,
    title: doc.metadata.title,
    author: doc.metadata.author,
    publicationDate: doc.metadata.publicationDate ? new Date(doc.metadata.publicationDate) : undefined,
    sourceUrl: doc.metadata.sourceUrl,
    collectionId: options.collectionId,
    pageCount: doc.metadata.pageCount,
    content: doc.content,
    createdAt: new Date(doc.metadata.timestamp),
  }));

  console.log(`Converted ${knowledgeDocuments.length} documents`);

  console.log("\n7. Storing Documents in Database");
  console.log("-".repeat(60));

  let stored = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Load all existing documents once for efficient checking
  const existingDocs = await storage.getKnowledgeDocuments({
    collectionId: options.collectionId,
  });
  const existingHashMap = new Map(existingDocs.map(d => [d.fileHash, d]));

  for (let i = 0; i < knowledgeDocuments.length; i++) {
    const doc = knowledgeDocuments[i];
    const progress = `[${i + 1}/${knowledgeDocuments.length}]`;

    try {
      const existingDoc = existingHashMap.get(doc.fileHash);

      if (existingDoc) {
        // Document already exists
        if (options.replace) {
          // Update existing document
          await storage.storeKnowledgeDocuments([doc]);
          console.log(`  ${progress} Updated: ${doc.title}`);
          updated++;
        } else {
          // Skip existing document (default behavior)
          console.log(`  ${progress} Skipped: ${doc.title} (already exists)`);
          skipped++;
          continue;
        }
      } else {
        // New document
        await storage.storeKnowledgeDocuments([doc]);
        console.log(`  ${progress} Stored: ${doc.title}`);
        stored++;
      }
    } catch (error: any) {
      console.log(`  ${progress} FAILED: ${doc.title}: ${error.message}`);
      errors++;
    }
  }

  console.log("\n8. Verification");
  console.log("-".repeat(60));

  // Get document count directly
  const countResult = await storage.query(
    `SELECT COUNT(*) as count FROM knowledge_documents WHERE collection_id = $1`,
    [options.collectionId]
  );
  const documentCount = parseInt(countResult.rows[0].count);

  console.log(`Database verification:`);
  console.log(`  Documents in database: ${documentCount}`);

  await storage.close();

  console.log("\n" + "=".repeat(60));
  console.log("Database Seeding Complete!");
  console.log("=".repeat(60));

  console.log("\n Summary:");
  console.log(`  Collection: ${collection.name} (${options.collectionId})`);
  console.log(`  New documents stored: ${stored}`);
  console.log(`  Existing documents updated: ${updated}`);
  console.log(`  Documents skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);

}

// Run the workflow (ESM entry point)
runDatabaseSeeding().catch((error) => {
  console.error("\nERROR: Error during database seeding:", error.message);
  console.error(error.stack);
  process.exit(1);
});
