/**
 * Type definitions for AI Conversation System
 *
 * This module defines all types for the deterministic multi-stage conversation
 * system that gathers context before executing RAG queries.
 */

// ============================================================================
// Conversation State Management
// ============================================================================

export type ConversationState =
  | "CLASSIFY_INTENT"
  | "EXTRACT_CONTEXT"
  | "GATHER_CONTEXT"
  | "VALIDATE_CONTEXT"
  | "CONSTRUCT_RAG_QUERY"
  | "EXECUTE_RAG"
  | "GENERATE_ANSWER"
  | "AWAIT_FOLLOWUP";

export type QueryIntent =
  | "LA_EMAIL_ANALYSIS"
  | "REPORT_WRITING"
  | "DEREGISTRATION"
  | "LEGAL_RIGHTS"
  | "EDUCATIONAL_APPROACH"
  | "ADMIN_PROCESS"
  | "GENERAL_QUESTION";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface ConversationSession {
  sessionId: string;
  userId?: string;
  state: ConversationState;
  intent?: QueryIntent;
  originalQuery: string;
  requiredContext: ContextField[];
  gatheredContext: Partial<ContextData>;
  contextQuestionsAsked: string[];
  ragQuery?: string;
  ragResults?: any[]; // SearchResult[] from existing types
  finalAnswer?: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Context Management
// ============================================================================

export type ValidationType = "text" | "enum" | "number" | "boolean";

export interface ContextField {
  key: string;
  question: string;
  required: boolean;
  validationType: ValidationType;
  validationOptions?: string[];
  dependsOn?: string;
}

export interface ContextData {
  // Location/Administrative
  localAuthority?: string;

  // Child Information
  childAge?: number;
  hasSEN?: boolean;
  hasEHCP?: boolean;

  // Educational Status
  currentSchoolType?: "state" | "private" | "special" | "never-attended";
  deregDate?: string;
  educationalApproach?: string;

  // LA Communication
  emailContent?: string;
  receivedSAO?: boolean;

  // Specific Concerns
  specificConcern?: string;
  processQuestion?: string;
  legalConcern?: string;
}

// ============================================================================
// Intent Classification
// ============================================================================

export interface IntentClassificationResult {
  intent: QueryIntent;
  confidence?: number;
  reasoning?: string;
}

// ============================================================================
// RAG Query Construction
// ============================================================================

export interface RAGQueryOptions {
  intent: QueryIntent;
  context: ContextData;
  originalQuery: string;
}

export interface RAGQueryResult {
  query: string;
  collectionFilter?: string | string[];
  metadata?: Record<string, any>;
}

// ============================================================================
// Prompt Generation
// ============================================================================

export interface PromptGenerationOptions {
  intent: QueryIntent;
  context: ContextData;
  originalQuery: string;
  ragResults: any[];
}

// ============================================================================
// State Transition
// ============================================================================

export interface StateTransitionResult {
  nextState: ConversationState;
  response: string;
  updatedSession: ConversationSession;
}

// ============================================================================
// Context Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  missingFields?: string[];
  invalidFields?: Array<{ field: string; reason: string }>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ConversationConfig {
  openaiApiKey: string;
  vectorService: any; // VectorIndexService
  maxContextQuestions?: number;
  sessionTimeoutMinutes?: number;
}
