/**
 * Personal AI Assistant Configuration
 *
 * Defines the personal assistant with dynamic system prompt generation
 * based on user profile, memories, and personality state.
 */

import { getPersonalAssistantPrompt, PromptContext } from "./niimi-prompts";

/**
 * Assistant configuration interface
 */
export interface AssistantConfig {
  id: string;
  name: string;
  description: string;
  defaultSchema: "public";
  getSystemPrompt: (context: PromptContext) => string;
}

/**
 * Single personal assistant configuration
 */
const PERSONAL_ASSISTANT: AssistantConfig = {
  id: "personal-assistant",
  name: "Personal AI Assistant",
  description: "Your trusted AI companion for memory, tasks, knowledge, and proactive support",
  defaultSchema: "public",
  getSystemPrompt: (context: PromptContext) => getPersonalAssistantPrompt(context),
};

/**
 * Get the personal assistant configuration
 * @param id Assistant ID (always "personal-assistant")
 * @returns Personal assistant configuration
 */
export function getAssistant(id: string = "personal-assistant"): AssistantConfig {
  return PERSONAL_ASSISTANT;
}

/**
 * Get list of available assistants (single personal assistant)
 * @returns Array with personal assistant configuration
 */
export function listAssistants(): AssistantConfig[] {
  return [PERSONAL_ASSISTANT];
}

/**
 * Get list of assistant IDs (single ID)
 * @returns Array with personal-assistant ID
 */
export function getAssistantIds(): string[] {
  return [PERSONAL_ASSISTANT.id];
}
