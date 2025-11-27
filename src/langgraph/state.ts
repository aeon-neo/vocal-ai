import { Annotation } from "@langchain/langgraph";

/**
 * Vocal AI Examination System State
 *
 * Defines the state structure for the LangGraph multi-agent system.
 * State is passed between agents and persisted across examination turns.
 */

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface AgentExecution {
  agent: string;
  action: string;
  timestamp: Date;
  result?: any;
}

export interface SafetyAssessment {
  safetyLevel: "safe" | "caution" | "boundary" | "crisis";
  concerns: string[];
  boundaryType?: string;
  recommendedResponse?: string;
  reasoning: string;
}

export interface StudentEmotionalState {
  confidenceLevel: "confident" | "hesitant" | "uncertain";
  fluencyAssessment: "fluent" | "moderate" | "struggling";
  detectedEmotions?: any;
  bodyLanguageNotes?: string;
}

export interface CulturalPreferences {
  ethnicity?: string;
  upbringing?: string;
  religion?: string;
  politicalPosition?: string;
  preferredLanguage?: string;
  rawResponse: string;
  assessed: boolean;
}

export interface CTAssessment {
  turnNumber: number;
  examinerQuestion: string;
  studentResponse: string;
  // CT Skill scores (0-100)
  analysingArguments: number;
  judgingRelevance: number;
  evaluatingClaims: number;
  constructingArguments: number;
  formingJudgements: number;
  overallScore: number;
  examinerNotes: string;
}

/**
 * State Annotation with custom reducers
 *
 * Reducers define how state updates are merged:
 * - messages: Append new messages to conversation history
 * - executionLog: Append new executions to the log
 * - All other fields: Replace with new value (default behavior)
 */
export const VocalAIState = Annotation.Root({
  // Session Identity
  sessionId: Annotation<string>(),

  // Exam Configuration
  language: Annotation<string>({
    reducer: (current, update) => update || current || "en",
    default: () => "en",
  }),
  topic: Annotation<string>(),
  scenario: Annotation<string>(), // The full scenario/stimulus text presented to the student
  turnCount: Annotation<number>({
    reducer: (current, update) => update ?? current ?? 0,
    default: () => 0,
  }),

  // Conversation Messages
  messages: Annotation<Message[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),

  // Current Student Message
  currentUserMessage: Annotation<string>(),

  // Conversation History (full dialog context)
  conversationHistory: Annotation<Array<{ role: string; content: string }>>({
    reducer: (current, update) => update,
    default: () => [],
  }),

  // Safety Assessment (from Insula Agent)
  safetyAssessment: Annotation<SafetyAssessment>(),

  // Agent Execution Log
  executionLog: Annotation<AgentExecution[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),

  // Tool Calls (from Cortex)
  toolCalls: Annotation<any[]>({
    reducer: (current, update) => update,
    default: () => [],
  }),

  // Current Context (time of exam, etc.)
  currentContext: Annotation<any>(),

  // Emotional Context (from video/audio analysis)
  emotionalContext: Annotation<{
    video: any | null;
    audio: any | null;
  }>(),

  // Student Emotional State (tracked by Limbic)
  studentEmotionalState: Annotation<StudentEmotionalState>(),

  // Cultural Preferences (assessed at turn 0)
  culturalPreferences: Annotation<CulturalPreferences>(),

  // CT Assessment Results (from Logic agent - per turn)
  ctAssessment: Annotation<CTAssessment>(),

  // RAG Results (CT materials from knowledge base)
  ragResults: Annotation<any[]>(),

  // Final Response (Socratic question from Cortex)
  finalResponse: Annotation<string>(),

  // Flag to indicate final assessment (skip TTS)
  isFinalAssessment: Annotation<boolean>({
    default: () => false,
  }),

  // Routing Decision
  nextAgent: Annotation<string>(),

  // Error Handling
  error: Annotation<string>(),
});

export type VocalAIStateType = typeof VocalAIState.State;

// Legacy export for backward compatibility during migration
export { VocalAIState as NiimiState };
export type NiimiStateType = VocalAIStateType;
