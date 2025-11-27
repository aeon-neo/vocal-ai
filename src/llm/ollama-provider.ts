/**
 * Ollama LLM Provider
 *
 * Connects to local Ollama instance via HTTP API
 * Supports tool calling via JSON mode
 * Includes retry logic with exponential backoff for reliability
 */

import {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMResponse,
  LLMToolCall,
} from "./types";
import { withRetry } from "../utils/retry";

interface OllamaRequest {
  model: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
  format?: "json";
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export class OllamaProvider implements LLMProvider {
  private model: string;
  private baseUrl: string;

  constructor(config: { model: string; baseUrl?: string }) {
    this.model = config.model;
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  async generate(
    messages: LLMMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    }
  ): Promise<LLMResponse> {
    // Combine system messages and system prompt
    const systemMessages = messages.filter((m) => m.role === "system");
    const allSystemContent = [
      ...(options?.systemPrompt ? [options.systemPrompt] : []),
      ...systemMessages.map((m) => m.content),
    ].join("\n\n");

    // Build messages array with system at the start if needed
    const ollamaMessages = [];
    if (allSystemContent) {
      ollamaMessages.push({
        role: "system",
        content: allSystemContent,
      });
    }

    // Add non-system messages
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    ollamaMessages.push(
      ...nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    );

    const requestBody: OllamaRequest = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0,
        num_predict: options?.maxTokens || 4096,
      },
    };

    // Wrap HTTP call with retry logic (3 attempts: 1s, 2s, 4s delays)
    const data = await withRetry(
      async () => {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = new Error(
            `Ollama request failed: ${response.status} ${response.statusText}`
          );
          (error as any).status = response.status;
          throw error;
        }

        return (await response.json()) as OllamaResponse;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      }
    );

    return {
      content: data.message.content,
      finishReason: data.done ? "end_turn" : "max_tokens",
    };
  }

  async generateWithTools(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    }
  ): Promise<LLMResponse> {
    // Ollama doesn't have native tool calling like Claude
    // We implement it via JSON mode + prompt engineering

    const toolsDescription = tools
      .map(
        (tool) =>
          `**${tool.name}**: ${tool.description}\nParameters: ${JSON.stringify(tool.input_schema, null, 2)}`
      )
      .join("\n\n");

    const toolCallingPrompt = `You have access to the following tools:

${toolsDescription}

To call a tool, respond with JSON in this format:
{
  "thought": "Your reasoning about which tool to use",
  "tool_calls": [
    {
      "name": "tool_name",
      "input": { "param1": "value1", "param2": "value2" }
    }
  ]
}

If you don't need to call any tools, respond with:
{
  "thought": "Your reasoning",
  "response": "Your natural language response to the user"
}

IMPORTANT: Only respond with valid JSON. No markdown code blocks, no explanations outside the JSON.`;

    // Combine system messages with tool calling instructions
    const systemMessages = messages.filter((m) => m.role === "system");
    const allSystemContent = [
      ...(options?.systemPrompt ? [options.systemPrompt] : []),
      ...systemMessages.map((m) => m.content),
      toolCallingPrompt,
    ].join("\n\n");

    const ollamaMessages = [];
    if (allSystemContent) {
      ollamaMessages.push({
        role: "system",
        content: allSystemContent,
      });
    }

    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    ollamaMessages.push(
      ...nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    );

    const requestBody: OllamaRequest = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      format: "json", // Request JSON output
      options: {
        temperature: options?.temperature ?? 0,
        num_predict: options?.maxTokens || 4096,
      },
    };

    // Wrap HTTP call with retry logic (3 attempts: 1s, 2s, 4s delays)
    const data = await withRetry(
      async () => {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const error = new Error(
            `Ollama request failed: ${response.status} ${response.statusText}`
          );
          (error as any).status = response.status;
          throw error;
        }

        return (await response.json()) as OllamaResponse;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      }
    );

    // Parse the JSON response
    try {
      const parsed = JSON.parse(data.message.content);

      // Check if there are tool calls
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        const toolCalls: LLMToolCall[] = parsed.tool_calls.map(
          (tc: any, idx: number) => ({
            id: `call_${idx}`, // Generate IDs since Ollama doesn't provide them
            name: tc.name,
            input: tc.input,
          })
        );

        return {
          content: parsed.thought || "",
          toolCalls,
          finishReason: "tool_use",
        };
      }

      // No tool calls, return the response
      return {
        content: parsed.response || parsed.thought || JSON.stringify(parsed),
        finishReason: "end_turn",
      };
    } catch (error) {
      // If JSON parsing fails, return raw content
      console.error("Failed to parse Ollama JSON response:", error);
      return {
        content: data.message.content,
        finishReason: "end_turn",
      };
    }
  }

  getProviderName(): string {
    return "ollama";
  }

  getModelName(): string {
    return this.model;
  }
}
