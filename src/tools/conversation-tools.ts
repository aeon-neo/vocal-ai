import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { PostgresService } from "../storage";

/**
 * Conversation Management Tools - Vocal AI
 *
 * Tools for managing exam conversation history.
 */

/**
 * Clear conversation history tool
 * Deletes all conversation messages for a session
 */
export function createClearConversationHistoryTool(storageService: PostgresService) {
  return tool(
    async ({ confirm, sessionId }) => {
      try {
        if (!confirm) {
          return JSON.stringify({
            success: false,
            message: "Deletion cancelled - confirm parameter must be true",
          });
        }

        const targetSession = sessionId || "primary";
        const result = await storageService.query(
          `DELETE FROM conversation_history WHERE session_id = $1`,
          [targetSession]
        );

        const deletedCount = result.rowCount || 0;

        return JSON.stringify({
          success: true,
          messagesDeleted: deletedCount,
          message: `Cleared ${deletedCount} messages from conversation history`,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to clear conversation history",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: "clear_conversation_history",
      description: `Clear all conversation history for a session.

Use this when:
- Starting a fresh exam session
- User requests to clear history

IMPORTANT: This is permanent and cannot be undone.`,
      schema: z.object({
        confirm: z.boolean().describe("Must be true to proceed with deletion"),
        sessionId: z.string().nullable().optional().describe("Session ID to clear (default: primary)"),
      }),
    }
  );
}

/**
 * Get conversation timeline tool
 * Retrieves conversation history chronologically
 */
export function createGetConversationTimelineTool(storageService: PostgresService) {
  return tool(
    async ({ limit, offset, sessionId, orderBy }) => {
      try {
        const targetSession = sessionId || "primary";
        const params: any[] = [targetSession];

        // Get statistics
        const statsResult = await storageService.query(
          `SELECT
            COUNT(*) as total_count,
            MIN(created_at) as first_message_date,
            MAX(created_at) as last_message_date
          FROM conversation_history
          WHERE session_id = $1`,
          params
        );

        const stats = statsResult.rows[0];
        const totalCount = parseInt(stats.total_count);

        if (totalCount === 0) {
          return JSON.stringify({
            success: true,
            totalMessages: 0,
            message: "No conversation history found",
          });
        }

        // Get paginated messages
        const sortOrder = orderBy === "oldest" ? "ASC" : "DESC";
        const messagesResult = await storageService.query(
          `SELECT * FROM conversation_history
          WHERE session_id = $1
          ORDER BY created_at ${sortOrder}
          LIMIT $2
          OFFSET $3`,
          [targetSession, limit || 50, offset || 0]
        );

        const messages = messagesResult.rows.map((row: any) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.created_at,
        }));

        return JSON.stringify({
          success: true,
          totalMessages: totalCount,
          firstMessageDate: stats.first_message_date,
          lastMessageDate: stats.last_message_date,
          messagesShown: messages.length,
          offset: offset || 0,
          hasMore: (offset || 0) + messages.length < totalCount,
          messages: messages.map((msg: any) => ({
            role: msg.role,
            content: msg.content.substring(0, 300) + (msg.content.length > 300 ? "..." : ""),
            timestamp: msg.createdAt,
          })),
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to retrieve conversation timeline",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: "get_conversation_timeline",
      description: `Get chronological conversation history for an exam session.

Use this when:
- Reviewing previous dialog in the session
- Checking what questions have been asked
- Getting context for current turn

Returns messages in chronological order with pagination.`,
      schema: z.object({
        limit: z.number().nullable().optional().describe("Number of messages to return (default: 50)"),
        offset: z.number().nullable().optional().describe("Pagination offset (default: 0)"),
        sessionId: z.string().nullable().optional().describe("Session ID (default: primary)"),
        orderBy: z.enum(["newest", "oldest"]).nullable().optional().describe("Sort order (default: newest)"),
      }),
    }
  );
}

/**
 * Search conversation history tool
 * Simple keyword search (no embeddings needed)
 */
export function createSearchConversationHistoryTool(storageService: PostgresService) {
  return tool(
    async ({ query, topK, sessionId }) => {
      try {
        const targetSession = sessionId || "primary";

        // Simple ILIKE search for keywords
        const searchResult = await storageService.query(
          `SELECT id, role, content, created_at
          FROM conversation_history
          WHERE session_id = $1
            AND content ILIKE $2
          ORDER BY created_at DESC
          LIMIT $3`,
          [targetSession, `%${query}%`, topK || 10]
        );

        return JSON.stringify({
          success: true,
          searchMethod: "keyword",
          conversationCount: searchResult.rows.length,
          conversations: searchResult.rows.map((row: any) => ({
            role: row.role,
            content: row.content,
            timestamp: row.created_at,
          })),
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to search conversation history",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: "search_conversation_history",
      description: `Search past conversations using keyword matching.

Use this when:
- Looking for specific topics discussed in the exam
- Finding what the student said about a particular concept
- Reviewing previous exchanges on a subject

Returns matching conversation messages.`,
      schema: z.object({
        query: z.string().describe("What to search for"),
        topK: z.number().nullable().optional().describe("Number of results (default: 10)"),
        sessionId: z.string().nullable().optional().describe("Session ID (default: primary)"),
      }),
    }
  );
}
