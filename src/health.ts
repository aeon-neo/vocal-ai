import { Router, Request, Response } from "express";
import { AppServices } from "./api/server";

export function createHealthRouter(services: AppServices): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      // Check database connection
      const dbCheck = await services.storageService.query("SELECT NOW() as time");
      const dbConnected = dbCheck.rows.length > 0;

      // Get vector stats (stub - getVectorStats doesn't exist yet)
      const vectorStats = {
        exists: true,
        count: 0,
        tableName: "knowledge_embeddings"
      };

      // Get collection count
      const collectionsResult = await services.storageService.query(
        `SELECT COUNT(DISTINCT collection_id) as count
         FROM knowledge_embeddings
         WHERE collection_id IS NOT NULL`
      );

      // Get document count
      const documentsResult = await services.storageService.query(
        `SELECT COUNT(*) as count FROM knowledge_documents`
      );

      const status = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          database: {
            connected: dbConnected,
            serverTime: dbCheck.rows[0]?.time,
          },
          vectors: {
            exists: vectorStats.exists,
            count: vectorStats.count,
            tableName: vectorStats.tableName,
          },
          collections: {
            count: parseInt(collectionsResult.rows[0].count),
          },
          documents: {
            count: parseInt(documentsResult.rows[0].count),
          },
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          uptime: process.uptime(),
        },
      };

      res.json(status);
    } catch (error: any) {
      console.error("Health check error:", error);
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });

  return router;
}
