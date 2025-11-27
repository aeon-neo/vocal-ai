/**
 * LLM Abstraction Layer - Types
 *
 * Provides a unified interface for different LLM providers (Claude, Ollama, etc.)
 * Supports both simple text generation and tool calling.
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  finishReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface LLMConfig {
  provider: "openai" | "claude" | "ollama";
  model: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string; // For OpenAI or Claude
  baseUrl?: string; // For Ollama
}

/**
 * Base interface for LLM providers
 */
export interface LLMProvider {
  /**
   * Generate text completion without tools
   */
  generate(
    messages: LLMMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    }
  ): Promise<LLMResponse>;

  /**
   * Generate with tool calling support
   */
  generateWithTools(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    }
  ): Promise<LLMResponse>;

  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Get the model name
   */
  getModelName(): string;
}
