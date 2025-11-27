#!/usr/bin/env node

/**
 * Chunking Workflow - Chunks PDF documents for RAG pipeline
 * Breaks long CWSB documents into optimal pieces for embedding and retrieval
 */

import { PDFExtractor } from "../pdf-extractor";
import { PDFDocument } from "../lib/types";
import { Chunker } from "../chunker";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "@xenova/transformers";

// Configuration constants
// all-mpnet-base-v2 has max sequence length of 384 tokens
// Token counting is performed DURING chunking (accounting for collection name prefix)
const MAX_TOKENS = 384; // Token limit for all-mpnet-base-v2

let tokenizer: any = null;

/**
 * Initialize the tokenizer for all-mpnet-base-v2
 */
async function initializeTokenizer() {
    if (!tokenizer) {
        console.log(" Initializing tokenizer for all-mpnet-base-v2...");
        tokenizer = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
        console.log(" Tokenizer initialized");
    }
}

/**
 * Count actual tokens using the model's tokenizer
 */
async function countTokens(text: string): Promise<number> {
    if (!tokenizer) {
        await initializeTokenizer();
    }
    // Tokenize and return token count
    const encoded = await tokenizer.tokenizer(text);
    return encoded.input_ids.data.length;
}

async function runChunkingDemo() {
    console.log("\n Text Chunking");
    console.log("=".repeat(50));

    // Get command line arguments
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(
            " Please provide a collection ID as an argument"
        );
        console.log(' Usage: npm run chunk "collection-id"');
        console.log(' Example: npm run chunk "cwsb-bill"');
        console.log("\n Available cached documents:");

        // List available cache files
        const cacheDir = "./files/raw_docs_cache";
        if (fs.existsSync(cacheDir)) {
            const files = fs
                .readdirSync(cacheDir)
                .filter((f) => f.endsWith("_raw_docs.json"));
            if (files.length > 0) {
                files.forEach((file) => {
                    const cacheId = file.replace("_raw_docs.json", "");
                    console.log(`   • "${cacheId}"`);
                });
            } else {
                console.log("   No cached documents found. Run ingestion first:");
                console.log("   npm run ingest-pdfs <collection-id> <pdf-directory>");
            }
        }
        console.log("=".repeat(50));
        process.exit(1);
    }

    const cacheId = args[0];

    // Initialize tokenizer for accurate token counting
    await initializeTokenizer();

    // Continue with main processing...
    // Load documents from cache
    const extractor = new PDFExtractor();
    const { found, documents } = await extractor.loadCachedDocuments(cacheId);

    if (!found || documents.length === 0) {
        console.log(` No cached documents found for "${cacheId}"`);
        console.log(" First run PDF ingestion:");
        console.log(`   npm run ingest-pdfs "${cacheId}" <pdf-directory>`);
        console.log("=".repeat(50));
        process.exit(1);
    }

    console.log(` Target: "${cacheId}" collection`);
    console.log(` Found ${documents.length} cached documents`);

    // Calculate total content statistics
    const totalContent = documents.map((doc) => doc.content).join("\n\n");
    const totalChars = totalContent.length;
    const avgDocLength = Math.round(totalChars / documents.length);

    console.log(` Document Collection Statistics:`);
    console.log(`   Total content: ${totalChars.toLocaleString()} characters`);
    console.log(`   Average document: ${avgDocLength.toLocaleString()} characters`);
    console.log(
        `   Estimated total tokens: ~${Math.ceil(totalChars / 4).toLocaleString()}`
    );

    // Show sample of documents
    console.log(`\n Sample Documents:`);
    documents.slice(0, 3).forEach((doc, index) => {
        console.log(
            `   ${index + 1}. "${doc.metadata.title
            }" (${doc.content.length.toLocaleString()} chars)`
        );
    });
    if (documents.length > 3) {
        console.log(`   ... and ${documents.length - 3} more documents`);
    }

    console.log("\n1. Loading Existing Chunks Cache");
    console.log("-".repeat(40));

    // Load existing chunks cache if it exists
    const chunksDir = "./files/chunks_cache";
    const chunksFile = path.join(chunksDir, `${cacheId}_chunks.json`);

    let existingChunksData: any = null;
    let existingDocHashes = new Set<string>();
    let unchangedChunks: any[] = [];

    if (fs.existsSync(chunksFile)) {
        try {
            const cacheContent = fs.readFileSync(chunksFile, 'utf-8');
            existingChunksData = JSON.parse(cacheContent);

            // Build set of document hashes that are already chunked
            existingChunksData.chunks.forEach((chunk: any) => {
                existingDocHashes.add(chunk.metadata.hash);
            });

            console.log(`Found existing chunks cache`);
            console.log(`  Previously chunked: ${existingChunksData.totalChunks} chunks from ${existingChunksData.documentCount} documents`);
            console.log(`  Cache created: ${new Date(existingChunksData.timestamp).toLocaleString()}`);
        } catch (error) {
            console.log(` Could not load existing cache (will rebuild): ${error instanceof Error ? error.message : String(error)}`);
        }
    } else {
        console.log(` No existing chunks cache found (first run)`);
    }

    console.log("\n2. Detecting Documents to Process");
    console.log("-".repeat(40));

    // Determine which documents need chunking
    const documentsToChunk = documents.filter(doc => !existingDocHashes.has(doc.metadata.hash));
    const unchangedDocs = documents.filter(doc => existingDocHashes.has(doc.metadata.hash));

    console.log(` Total documents: ${documents.length}`);
    console.log(` New or changed: ${documentsToChunk.length}`);
    console.log(` Unchanged: ${unchangedDocs.length}`);

    if (unchangedDocs.length > 0 && existingChunksData) {
        // Preserve chunks from unchanged documents
        unchangedChunks = existingChunksData.chunks.filter((chunk: any) =>
            unchangedDocs.some(doc => doc.metadata.hash === chunk.metadata.hash)
        );
        console.log(` Preserving: ${unchangedChunks.length} chunks from unchanged documents`);
    }

    console.log("\n3. Token-Aware Semantic Chunking");
    console.log("-".repeat(40));

    // Calculate collection name prefix tokens (added to each chunk for keyword matching)
    const collectionName = cacheId.replace(/-/g, ' ');
    const keywordBoost = `${collectionName}\n\n`;
    const prefixTokens = await countTokens(keywordBoost);
    const effectiveMaxTokens = MAX_TOKENS - prefixTokens;

    console.log(` Collection prefix: "${collectionName}" (${prefixTokens} tokens)`);
    console.log(` Effective chunk limit: ${effectiveMaxTokens} tokens (${MAX_TOKENS} - ${prefixTokens})`);

    // Chunk only new/changed documents using token-aware chunking
    const newChunks: Array<{
        content: string;
        sourceDoc: PDFDocument;
        chunkIndex: number;
    }> = [];

    if (documentsToChunk.length > 0) {
        console.log(` Chunking ${documentsToChunk.length} documents...`);

        for (const doc of documentsToChunk) {
            // Token-aware chunking (accounts for collection name prefix)
            const docChunks = await Chunker.chunkByParagraph(doc.content, effectiveMaxTokens, countTokens);
            docChunks.forEach((chunk, index) => {
                newChunks.push({
                    content: chunk,
                    sourceDoc: doc,
                    chunkIndex: index,
                });
            });
        }
        console.log(`Created ${newChunks.length} token-aware chunks from ${documentsToChunk.length} documents`);
    } else {
        console.log(` No new documents to chunk`);
    }

    // Calculate total chunks
    const totalChunks = newChunks.length + unchangedChunks.length;

    console.log(` Total chunks: ${totalChunks} (${newChunks.length} new, ${unchangedChunks.length} preserved)`);
    console.log(` Semantic boundaries preserved across all documents`);

    // Analyze chunk sizes (only for new chunks if any)
    if (newChunks.length > 0) {
        const chunkLengths = newChunks.map((c) => c.content.length);
        const avgChunkSize = Math.round(
            chunkLengths.reduce((sum, len) => sum + len, 0) / chunkLengths.length
        );
        const minChunk = Math.min(...chunkLengths);
        const maxChunk = Math.max(...chunkLengths);

        console.log(`\n New chunks analysis:`);
        console.log(`   Average: ${avgChunkSize} characters`);
        console.log(`   Range: ${minChunk} - ${maxChunk} characters`);
    }

    // Show example of newly chunked document if any
    if (documentsToChunk.length > 0) {
        console.log("\n4. Chunking Example with Real Text");
        console.log("-".repeat(40));

        const exampleDoc = documentsToChunk[0];
        console.log(` Source Document: "${exampleDoc.metadata.title}"`);
        console.log(` Original length: ${exampleDoc.content.length} characters`);

        const originalParas = exampleDoc.content
            .split(/\n\s*\n/)
            .filter((p) => p.trim().length > 0);
        console.log(` Original has ${originalParas.length} paragraphs`);

        const exampleChunks = newChunks.filter(c => c.sourceDoc.metadata.hash === exampleDoc.metadata.hash);
        console.log(` After chunking: ${exampleChunks.length} chunks created`);

        // Show first 2 chunks
        exampleChunks.slice(0, 2).forEach((chunk, index) => {
            const preview = chunk.content.substring(0, 100).replace(/\n/g, " ");
            console.log(`\n   Chunk ${index + 1} (${chunk.content.length} chars):`);
            console.log(`   "${preview}..."`);
        });
    }

    console.log("\n5. Summary");
    console.log("-".repeat(40));

    console.log(` Collection: "${cacheId}"`);
    console.log(` Documents processed: ${documents.length}`);
    console.log(` New chunks created: ${newChunks.length}`);
    console.log(` Preserved chunks: ${unchangedChunks.length}`);
    console.log(` Total chunks: ${totalChunks}`);

    console.log("\n6. Saving Chunks Cache");
    console.log("-".repeat(40));

    if (!fs.existsSync(chunksDir)) {
        fs.mkdirSync(chunksDir, { recursive: true });
    }

    // Create structured chunk data for new chunks with actual token counts
    console.log(` Counting tokens for ${newChunks.length} chunks...`);
    const newStructuredChunks = await Promise.all(
        newChunks.map(async (chunk, index) => {
            // Augment chunk content with collection name for keyword matching
            // Convert collection-id format to readable name (e.g., "east-sussex" -> "east sussex")
            const collectionName = cacheId.replace(/-/g, ' ');

            // Add collection name at the start for keyword matching
            const keywordBoost = `${collectionName}\n\n`;
            const augmentedContent = keywordBoost + chunk.content;

            const tokenCount = await countTokens(augmentedContent);
            return {
                id: `${cacheId}_chunk_${Date.now()}_${index}`,
                text: augmentedContent,
                metadata: {
                    documentId: chunk.sourceDoc.id,
                    fileName: chunk.sourceDoc.metadata.fileName,
                    title: chunk.sourceDoc.metadata.title,
                    author: chunk.sourceDoc.metadata.author,
                    sourceUrl: chunk.sourceDoc.metadata.sourceUrl,
                    chunkIndex: chunk.chunkIndex,
                    totalChunks: newChunks.filter(
                        (c) => c.sourceDoc.id === chunk.sourceDoc.id
                    ).length,
                    collectionId: cacheId,
                    timestamp: chunk.sourceDoc.metadata.timestamp,
                    hash: chunk.sourceDoc.metadata.hash,
                    characterCount: augmentedContent.length,
                    tokenCount: tokenCount, // Actual token count from model's tokenizer
                },
            };
        })
    );
    console.log(`Token counting complete`);

    // Validate token counts against limits
    const oversizedChunks = newStructuredChunks.filter((c: any) => c.metadata.tokenCount > MAX_TOKENS);
    if (oversizedChunks.length > 0) {
        console.log(`\n ⚠️  WARNING: ${oversizedChunks.length} chunks exceed ${MAX_TOKENS} token limit!`);
        console.log(`   These will be truncated by the embedding model`);

        // Log oversized chunks to file for investigation
        const oversizedLog = {
            timestamp: Date.now(),
            collectionId: cacheId,
            totalChunks: newStructuredChunks.length,
            oversizedCount: oversizedChunks.length,
            chunks: oversizedChunks.map((c: any) => ({
                id: c.id,
                tokenCount: c.metadata.tokenCount,
                characterCount: c.metadata.characterCount,
                documentTitle: c.metadata.title,
                chunkIndex: c.metadata.chunkIndex,
                text: c.text,
            }))
        };

        const oversizedLogFile = path.join(chunksDir, `${cacheId}_oversized_chunks.json`);
        fs.writeFileSync(oversizedLogFile, JSON.stringify(oversizedLog, null, 2));

        console.log(`   Detailed log saved to: ${oversizedLogFile}`);
        console.log(`\n   Sample oversized chunks:`);
        oversizedChunks.slice(0, 3).forEach((c: any) => {
            console.log(`   - ${c.metadata.tokenCount} tokens, ${c.metadata.characterCount} chars`);
            console.log(`     "${c.text.substring(0, 80).replace(/\n/g, ' ')}..."`);
        });
    }

    // Combine preserved chunks with new chunks
    const allStructuredChunks = [...unchangedChunks, ...newStructuredChunks];

    // Calculate stats for all chunks
    const allChunkLengths = allStructuredChunks.map((c: any) =>
        c.metadata?.characterCount || c.text.length
    );
    const allTokenCounts = allStructuredChunks
        .map((c: any) => c.metadata?.tokenCount)
        .filter((t: any) => t !== undefined);

    const avgChunkSize = allChunkLengths.length > 0
        ? Math.round(allChunkLengths.reduce((sum, len) => sum + len, 0) / allChunkLengths.length)
        : 0;
    const minChunk = allChunkLengths.length > 0 ? Math.min(...allChunkLengths) : 0;
    const maxChunk = allChunkLengths.length > 0 ? Math.max(...allChunkLengths) : 0;
    const optimal = allChunkLengths.filter((len) => len >= 500 && len <= 3000).length;
    const quality = allChunkLengths.length > 0
        ? Math.round((optimal / allChunkLengths.length) * 100)
        : 0;

    // Token stats
    const avgTokens = allTokenCounts.length > 0
        ? Math.round(allTokenCounts.reduce((sum: number, count: number) => sum + count, 0) / allTokenCounts.length)
        : 0;
    const maxTokens = allTokenCounts.length > 0 ? Math.max(...allTokenCounts) : 0;
    const withinLimit = allTokenCounts.filter((t: number) => t <= MAX_TOKENS).length;

    const chunksData = {
        cacheId: cacheId,
        timestamp: Date.now(),
        documentCount: documents.length,
        totalChunks: allStructuredChunks.length,
        tokenLimit: MAX_TOKENS,
        embeddingModel: 'all-mpnet-base-v2',
        stats: {
            avgChunkSize: avgChunkSize,
            minChunkSize: minChunk,
            maxChunkSize: maxChunk,
            optimalChunks: optimal,
            qualityPercentage: quality,
            avgTokens: avgTokens,
            maxTokens: maxTokens,
            chunksWithinTokenLimit: withinLimit,
            tokenLimitCompliance: allTokenCounts.length > 0
                ? Math.round((withinLimit / allTokenCounts.length) * 100)
                : 0,
        },
        chunks: allStructuredChunks,
    };

    fs.writeFileSync(chunksFile, JSON.stringify(chunksData, null, 2));

    console.log(`Saved chunks cache to ${chunksFile}`);
    console.log(`  New chunks added: ${newStructuredChunks.length}`);
    console.log(`  Preserved chunks: ${unchangedChunks.length}`);
    console.log(`  Total chunks in cache: ${allStructuredChunks.length}`);

    if (allTokenCounts.length > 0) {
        console.log(`\n Token Analysis (all-mpnet-base-v2):`);
        console.log(`  Average tokens: ${avgTokens}`);
        console.log(`  Max tokens: ${maxTokens}`);
        console.log(`  Within ${MAX_TOKENS} limit: ${withinLimit}/${allTokenCounts.length} (${chunksData.stats.tokenLimitCompliance}%)`);
        if (maxTokens > MAX_TOKENS) {
            console.log(`  ⚠️  Some chunks exceed embedding model's ${MAX_TOKENS} token limit`);
        } else {
            console.log(`All chunks within token limit!`);
        }
    }

    console.log(`\n Next step: npm run vectorize ${cacheId}`);

}

// Run the workflow (ESM entry point)
runChunkingDemo().catch(console.error);