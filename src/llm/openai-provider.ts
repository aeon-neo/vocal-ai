/**
 * OpenAI LLM Provider
 *
 * Wraps the OpenAI SDK to provide a unified interface
 * Includes retry logic with exponential backoff for reliability
 */

import OpenAI from "openai";
import {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMResponse,
  LLMToolCall,
} from "./types";
import { withRetry } from "../utils/retry";

export class OpenAIProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;

  constructor(config: { model: string; apiKey?: string }) {
    this.model = config.model;
    this.openai = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  async generate(
    messages: LLMMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    }
  ): Promise<LLMResponse> {
    // Build messages array for OpenAI
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system prompt if provided
    if (options?.systemPrompt) {
      openaiMessages.push({
        role: "system",
        content: options.systemPrompt,
      });
    }

    // Convert messages to OpenAI format
    for (const m of messages) {
      if (m.role === "system" && !options?.systemPrompt) {
        // Include system messages if no explicit system prompt
        openaiMessages.push({
          role: "system",
          content: m.content,
        });
      } else if (m.role !== "system") {
        openaiMessages.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }
    }

    // Wrap API call with retry logic (3 attempts: 1s, 2s, 4s delays)
    const response = await withRetry(
      () =>
        this.openai.chat.completions.create({
          model: this.model,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0,
          messages: openaiMessages,
        }),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      }
    );

    const content = response.choices[0]?.message?.content || "";

    return {
      content,
      finishReason: this.mapFinishReason(response.choices[0]?.finish_reason),
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
    // Build messages array for OpenAI
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system prompt if provided
    if (options?.systemPrompt) {
      openaiMessages.push({
        role: "system",
        content: options.systemPrompt,
      });
    }

    // Convert messages to OpenAI format
    for (const m of messages) {
      if (m.role === "system" && !options?.systemPrompt) {
        openaiMessages.push({
          role: "system",
          content: m.content,
        });
      } else if (m.role !== "system") {
        openaiMessages.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }
    }

    // Convert tools to OpenAI format
    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    // Wrap API call with retry logic (3 attempts: 1s, 2s, 4s delays)
    const response = await withRetry(
      () =>
        this.openai.chat.completions.create({
          model: this.model,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0,
          messages: openaiMessages,
          tools: openaiTools,
        }),
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      }
    );

    const message = response.choices[0]?.message;
    const content = message?.content || "";
    const toolCalls: LLMToolCall[] = [];

    // Extract tool calls from response
    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === "function") {
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || "{}"),
          });
        }
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(response.choices[0]?.finish_reason),
    };
  }

  getProviderName(): string {
    return "openai";
  }

  getModelName(): string {
    return this.model;
  }

  private mapFinishReason(
    finishReason: string | null | undefined
  ): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" {
    switch (finishReason) {
      case "stop":
        return "end_turn";
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "content_filter":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }
}
