/**
 * LLM Abstraction Layer - Main Export
 *
 * Provides a unified interface for different LLM providers
 * Default provider: OpenAI (gpt-4.5-preview for primary, gpt-4o-mini for fast)
 */

export * from "./types";
export * from "./openai-provider";
export * from "./ollama-provider";

import { LLMProvider, LLMConfig } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { OllamaProvider } from "./ollama-provider";

/**
 * Create an LLM provider based on configuration or environment variables
 *
 * Configuration priority:
 * 1. Explicit config passed to function
 * 2. Environment variables (LLM_PROVIDER, LLM_MODEL)
 * 3. Default: OpenAI with gpt-4o-mini
 *
 * Environment variables:
 * - LLM_PROVIDER: "openai" or "ollama" (default: "openai")
 * - LLM_MODEL: Model name (default: depends on provider)
 *   - For OpenAI: "gpt-4.5-preview" (default) or "gpt-4o-mini"
 *   - For Ollama: "qwen2.5:7b-instruct-q4_K_M" (default)
 * - OLLAMA_BASE_URL: Base URL for Ollama (default: "http://localhost:11434")
 *
 * Examples:
 *
 * // Use OpenAI (default)
 * const provider = createLLMProvider();
 *
 * // Use Ollama
 * const provider = createLLMProvider({ provider: "ollama", model: "qwen2.5:7b-instruct-q4_K_M" });
 *
 * // Use environment variables
 * // LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:7b-instruct-q4_K_M npm start
 * const provider = createLLMProvider();
 */
export function createLLMProvider(config?: Partial<LLMConfig>): LLMProvider {
  // Determine provider
  const provider =
    config?.provider ||
    (process.env.LLM_PROVIDER as "openai" | "ollama") ||
    "openai";

  // Determine model based on provider
  let model: string;
  if (provider === "openai") {
    model =
      config?.model ||
      process.env.LLM_MODEL ||
      "gpt-4o-mini";
  } else {
    // ollama
    model =
      config?.model ||
      process.env.LLM_MODEL ||
      "qwen2.5:7b-instruct-q4_K_M";
  }

  // Create provider
  if (provider === "openai") {
    return new OpenAIProvider({
      model,
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
    });
  } else if (provider === "ollama") {
    return new OllamaProvider({
      model,
      baseUrl: config?.baseUrl || process.env.OLLAMA_BASE_URL,
    });
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Helper function to create model-specific providers
 * Useful for agents that need specific model capabilities
 */
export function createProviderForModel(
  modelName: string,
  options?: {
    provider?: "openai" | "ollama";
    apiKey?: string;
    baseUrl?: string;
  }
): LLMProvider {
  // Auto-detect provider based on model name if not specified
  let provider = options?.provider;
  if (!provider) {
    if (modelName.startsWith("gpt-") || modelName.startsWith("o1")) {
      provider = "openai";
    } else {
      provider = "ollama";
    }
  }

  return createLLMProvider({
    provider,
    model: modelName,
    apiKey: options?.apiKey,
    baseUrl: options?.baseUrl,
  });
}

/**
 * Get model name mappings for easy migration
 */
export const MODEL_MAPPINGS = {
  // OpenAI models - Primary
  GPT_4_5_PREVIEW: "gpt-4.5-preview",
  GPT_4O: "gpt-4o",
  GPT_4O_MINI: "gpt-4o-mini",

  // Ollama models
  QWEN_7B_Q4: "qwen2.5:7b-instruct-q4_K_M",
  QWEN_7B_Q8: "qwen2.5:7b-instruct-q8_0",
  LLAMA_8B_Q4: "llama3.1:8b-instruct-q4_K_M",
  DEEPSEEK_8B_Q4: "deepseek-r1:8b-q4_K_M",
} as const;
