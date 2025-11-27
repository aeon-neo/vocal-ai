import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { VectorIndexService } from "../vector-index";

/**
 * Knowledge Tools - Vocal AI
 *
 * Tools for searching the knowledge base (RAG) for Critical Thinking content.
 * Used by Cortex for retrieving scenarios and assessment materials.
 */

/**
 * Create search knowledge tool
 * Searches the knowledge base using vector similarity (RAG)
 */
export function createSearchKnowledgeTool(vectorService: VectorIndexService) {
  return tool(
    async ({ query, topK }) => {
      try {
        const results = await vectorService.search(query, topK);

        // Format results for LLM consumption
        const formatted = results.map((r: any, i: number) => ({
          rank: i + 1,
          title: r.chunk?.metadata?.title || "Untitled",
          content: r.chunk?.content?.substring(0, 500) || "",
          relevance: (r.score * 100).toFixed(1) + "%",
        }));

        return JSON.stringify({
          query,
          resultsFound: formatted.length,
          results: formatted,
        }, null, 2);
      } catch (error) {
        return JSON.stringify({
          error: "Knowledge search failed",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: "search_knowledge",
      description: `Search the knowledge base for Critical Thinking scenarios and assessment materials.

Use this when:
- Starting a new Socratic dialog topic
- Looking for evidence and arguments to present to the student
- Finding relevant scenarios for assessment
- Retrieving marking criteria or assessment guidelines

The search uses vector similarity to find semantically relevant content.`,
      schema: z.object({
        query: z.string().describe("The search query. Be specific and include key concepts."),
        topK: z.number().nullable().default(5).describe("Number of results to return (default: 5, max: 20)"),
      }),
    }
  );
}
