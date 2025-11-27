// src/utils/verify-setup.ts
import * as dotenv from "dotenv";
import { Pool } from "pg";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
dotenv.config();

async function verifySetup() {
  console.log("Verifying Development Environment Setup");
  console.log("=".repeat(50));

  // Initialize tracking variable
  let allChecksPassed = true;

  // Check Node.js version
  console.log(`Node.js version: ${process.version}`);
  if (parseInt(process.version.slice(1)) < 18) {
    console.error("ERROR: Node.js 18+ required");
    allChecksPassed = false;
  } else {
    console.log("OK: Node.js version compatible");
  }

  // Check environment variables
  const requiredEnvVars = [
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`ERROR: Missing environment variable: ${envVar}`);
      allChecksPassed = false;
    }
  }

  if (allChecksPassed) {
    console.log("OK: Environment variables configured");
  }

  // Test PostgreSQL connection
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });

  try {
    const client = await pool.connect();
    console.log("OK: PostgreSQL connection successful");

    // Test pgvector extension
    const result = await client.query("SELECT version();");
    console.log(`PostgreSQL version: ${result.rows[0].version.split(" ")[1]}`);

    try {
      await client.query("SELECT '[1,2,3]'::vector;");
      console.log("OK: pgvector extension working");
    } catch (vectorError: any) {
      console.error("ERROR: pgvector extension not found");
      console.error("   Run: CREATE EXTENSION IF NOT EXISTS vector;");
      allChecksPassed = false;

      // Skip remaining vector tests if extension not found
      client.release();
      await pool.end();

      if (!allChecksPassed) {
        console.log("\nERROR: Setup verification failed");
        console.log("Please fix the issues above and run again");
        process.exit(1);
      }
      return;
    }

    // Test vector operations - only run if pgvector is working
    try {
      // Test vector distance calculation
      const distanceResult = await client.query(`
        SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector AS distance;
      `);
      console.log(`OK: Vector distance calculation: ${distanceResult.rows[0].distance}`);

      // Test vector operations with table
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_vectors (
          id SERIAL PRIMARY KEY,
          content TEXT,
          embedding VECTOR(3)
        );
      `);

      await client.query(`
        INSERT INTO test_vectors (content, embedding) 
        VALUES 
          ('First document', '[1,2,3]'),
          ('Second document', '[4,5,6]'),
          ('Third document', '[1,2,4]');
      `);

      const similarity = await client.query(`
        SELECT content, embedding <-> '[1,2,3]' AS distance
        FROM test_vectors
        ORDER BY distance
        LIMIT 3;
      `);

      console.log("OK: Vector similarity search working:");
      similarity.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. "${row.content}" (distance: ${row.distance})`);
      });

      // Cleanup test table
      await client.query("DROP TABLE test_vectors;");

    } catch (operationError: any) {
      console.error("ERROR: Vector operations failed:", operationError.message);
      allChecksPassed = false;
    }

    // Release the client connection
    client.release();

  } catch (error: any) {
    console.error("ERROR: PostgreSQL connection failed:", error.message);
    allChecksPassed = false;
  } finally {
    // Always end the pool connection
    await pool.end();
  }

  // Check optional dependencies
  console.log("\nOptional Dependencies");
  console.log("-".repeat(50));

  // Check ffmpeg (required for video analysis)
  try {
    await execAsync('ffmpeg -version');
    console.log("OK: ffmpeg installed - video analysis enabled");
  } catch (error) {
    console.log("WARNING: ffmpeg not found - video analysis disabled");
    console.log("   Image analysis will work without ffmpeg");
    console.log("   To enable video analysis, install ffmpeg:");
    console.log("   - Linux/WSL: sudo apt-get install ffmpeg");
    console.log("   - macOS: brew install ffmpeg");
    console.log("   - Windows: choco install ffmpeg");
    console.log("   - Or download from: https://ffmpeg.org/download.html");
  }

  // Final status
  if (allChecksPassed) {
    console.log("\nSetup verification complete");
    console.log("All required dependencies are installed and configured");
  } else {
    console.log("\nERROR: Setup verification failed");
    console.log("Please fix the issues above and run again");
    process.exit(1);
  }
}

// Run if executed directly
verifySetup().catch(console.error);

export { verifySetup };