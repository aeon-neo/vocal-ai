import * as dotenv from "dotenv";
import * as path from "path";
import { PDFExtractor } from "../pdf-extractor";
import { DocumentManager } from "../document-manager";

dotenv.config();

/**
 * PDF Ingestion Workflow
 * Extracts text from PDF documents and caches them for processing
 *
 * Usage:
 *   npm run ingest-pdfs <collection-id> <pdf-directory> [options]
 *
 * Arguments:
 *   collection-id    - Unique identifier for the document collection
 *   pdf-directory    - Path to directory containing PDF files
 *
 * Options:
 *   --name           - Collection display name (optional, auto-generated from ID)
 *   --no-recursive   - Don't search subdirectories (default: searches recursively)
 *
 * Examples:
 *   npm run ingest-pdfs cwsb-bill pdfs/bill
 *   npm run ingest-pdfs cwsb-guidance pdfs/guidance
 *   npm run ingest-pdfs hertfordshire-policies pdfs/hertfordshire --name "Hertfordshire CWSB Policies"
 */

interface IngestOptions {
  collectionId: string;
  pdfDirectory: string;
  collectionName?: string;
  recursive: boolean;
}

function parseArguments(): IngestOptions {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("\nERROR: Error: Missing required arguments\n");
    console.log("Usage: npm run ingest-pdfs <collection-id> <pdf-directory> [options]\n");
    console.log("Arguments:");
    console.log("  collection-id    - Unique identifier for the document collection");
    console.log("  pdf-directory    - Path to directory containing PDF files\n");
    console.log("Options:");
    console.log("  --name <name>       - Collection display name");
    console.log("  --no-recursive      - Don't search subdirectories\n");
    console.log("Examples:");
    console.log('  npm run ingest-pdfs cwsb-bill pdfs/bill');
    console.log('  npm run ingest-pdfs cwsb-guidance pdfs/guidance');
    console.log('  npm run ingest-pdfs hertfordshire-policies pdfs/hertfordshire --name "Hertfordshire CWSB Policies"');
    process.exit(1);
  }

  const collectionId = args[0];
  const pdfDirectory = args[1];

  const options: IngestOptions = {
    collectionId,
    pdfDirectory,
    recursive: true,
  };

  // Parse optional flags
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--name' && i + 1 < args.length) {
      options.collectionName = args[i + 1];
      i++;
    } else if (arg === '--no-recursive') {
      options.recursive = false;
    }
  }

  return options;
}

async function runPDFIngestion() {
  console.log("\n PDF Ingestion Workflow");
  console.log("=".repeat(60));

  const options = parseArguments();

  console.log("\nConfiguration:");
  console.log(`  Collection ID:   ${options.collectionId}`);
  console.log(`  PDF Directory:   ${options.pdfDirectory}`);
  console.log(`  Recursive:       ${options.recursive}`);

  console.log("\n1. Initializing Services");
  console.log("-".repeat(60));

  const pdfExtractor = new PDFExtractor();
  const docManager = new DocumentManager();

  console.log("PDF extractor initialized");
  console.log("Document manager initialized");

  console.log("\n2. Creating/Loading Collection");
  console.log("-".repeat(60));

  const collection = docManager.getOrCreateCollection(
    options.collectionId,
    options.collectionName
  );

  console.log(`Collection: ${collection.name}`);
  console.log(`  ID: ${collection.id}`);
  console.log(`  Created: ${collection.createdAt?.toLocaleString()}`);

  console.log("\n3. Extracting PDFs");
  console.log("-".repeat(60));

  const startTime = Date.now();

  const result = await pdfExtractor.processPDFDirectory(
    options.pdfDirectory,
    {
      collectionId: options.collectionId,
      recursive: options.recursive,
      onProgress: (message) => {
        console.log(`  ${message}`);
      },
    }
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n4. Extraction Summary");
  console.log("-".repeat(60));

  console.log(`Extraction complete in ${duration}s`);
  console.log(`  Total files: ${result.stats.total}`);
  console.log(`  Extracted: ${result.stats.extracted}`);
  console.log(`  Skipped: ${result.stats.skipped}`);
  console.log(`  Errors: ${result.stats.errors}`);

  if (result.documents.length === 0) {
    console.log("\nERROR: No documents were successfully extracted");
    console.log("   Check that the directory contains valid PDF files\n");
    process.exit(1);
  }

  console.log("\n5. Caching Documents");
  console.log("-".repeat(60));

  await pdfExtractor.cacheDocuments(
    options.collectionId,
    result.documents
  );

  console.log("\n" + "=".repeat(60));
  console.log("PDF Ingestion Complete!");
  console.log("=".repeat(60));

  console.log("\n Summary:");
  console.log(`  Collection: ${collection.name} (${options.collectionId})`);
  console.log(`  Total documents: ${result.documents.length}`);
  console.log(`  Newly extracted: ${result.stats.extracted}`);
  console.log(`  Skipped (unchanged): ${result.stats.skipped}`);


}

// Run the workflow (ESM entry point)
runPDFIngestion().catch((error) => {
  console.error("\nERROR: Error during PDF ingestion:", error.message);
  console.error(error.stack);
  process.exit(1);
});
