import OpenAI from "openai";
import { PostgresService } from "../storage";
import { VocalAIStateType } from "../langgraph/state";
import { parseJsonFromLLM } from "../utils/json-parser";
import { HumanMessage } from "@langchain/core/messages";
import { EventBus } from "../event-bus";

/**
 * Cortex - Socratic Examiner Agent
 *
 * The ONLY user-facing agent in the VocalAI examination system.
 * Conducts oral assessments using the Socratic method.
 *
 * Responsibilities:
 * 1. Entry Point - Receives all student responses
 * 2. Language Detection - Auto-detects and responds in student's language
 * 3. Socratic Dialog - Asks probing questions ONLY (never provides answers)
 * 4. RAG Integration - Retrieves CT scenarios and assessment materials
 * 5. Session Management - Tracks exam progress and turn count
 *
 * Key Principles:
 * - ONLY agent that communicates with student
 * - Uses Socratic method exclusively - asks questions, never gives answers
 * - Probes for deeper reasoning, challenges assumptions
 * - Culturally neutral, bias-free questioning
 * - Supports multilingual dialog (responds in student's detected language)
 *
 * Assessment Criteria (Cambridge A-Level CT):
 * - AO1: Analysing arguments (identifying premises and conclusions)
 * - AO2: Judging relevance, evaluating claims/inferences/explanations
 * - AO3: Constructing arguments, forming well-reasoned judgements
 *
 * Flow:
 * Student Response -> Cortex (Socratic question) -> Insula (safety) -> Student
 * [Async: Logic agent scores CT skills per turn]
 * [Async: Limbic agent tracks emotional state]
 */

export interface ExamSession {
  id: string;
  studentName?: string;
  language: string;
  topic?: string;
  status: "in_progress" | "completed" | "abandoned";
  turnCount: number;
  startedAt: Date;
}

export interface SocraticContext {
  sessionId: string;
  studentResponse: string;
  conversationHistory: Array<{ role: string; content: string }>;
  ragResults?: any[];
  emotionalContext?: {
    confidence?: string;
    fluency?: string;
    detectedEmotions?: any;
  };
  turnCount: number;
  language: string;
  topic?: string;
  scenario?: string; // The full scenario/stimulus text that was presented to the student
}

export class Cortex {
  private openai: OpenAI;
  private model: string;

  constructor(
    private storageService: PostgresService,
    openaiApiKey?: string
  ) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
    this.model = process.env.LLM_MODEL || "gpt-4o-mini";
  }

  /**
   * Detect language from student's speech/text
   * Returns ISO language code (e.g., 'en', 'es', 'zh', 'ar')
   */
  async detectLanguage(text: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 10,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "You are a language detector. Return ONLY the ISO 639-1 language code (e.g., 'en', 'es', 'zh', 'ar', 'fr'). Nothing else.",
          },
          {
            role: "user",
            content: `Detect the language: "${text.substring(0, 500)}"`,
          },
        ],
      });

      const detected = response.choices[0]?.message?.content?.trim().toLowerCase() || "en";
      console.log(`[Cortex] Detected language: ${detected}`);
      return detected;
    } catch (error) {
      console.error("[Cortex] Language detection error:", error);
      return "en"; // Default to English
    }
  }

  /**
   * Create a new exam session
   */
  async createExamSession(studentName?: string, language: string = "en"): Promise<ExamSession> {
    const result = await this.storageService.query(
      `INSERT INTO exam_sessions (student_name, language, status, turn_count, started_at)
       VALUES ($1, $2, 'in_progress', 0, NOW())
       RETURNING id, student_name, language, topic, status, turn_count, started_at`,
      [studentName || null, language]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      studentName: row.student_name,
      language: row.language,
      topic: row.topic,
      status: row.status,
      turnCount: row.turn_count,
      startedAt: row.started_at,
    };
  }

  /**
   * Update exam session
   */
  async updateExamSession(
    sessionId: string,
    updates: Partial<{ topic: string; scenario: string; language: string; turnCount: number; status: string }>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (updates.topic !== undefined) {
      setClauses.push(`topic = $${paramCount++}`);
      values.push(updates.topic);
    }
    if (updates.scenario !== undefined) {
      setClauses.push(`scenario = $${paramCount++}`);
      values.push(updates.scenario);
    }
    if (updates.language !== undefined) {
      setClauses.push(`language = $${paramCount++}`);
      values.push(updates.language);
    }
    if (updates.turnCount !== undefined) {
      setClauses.push(`turn_count = $${paramCount++}`);
      values.push(updates.turnCount);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramCount++}`);
      values.push(updates.status);
      if (updates.status === "completed" || updates.status === "abandoned") {
        setClauses.push(`ended_at = NOW()`);
      }
    }

    if (setClauses.length > 0) {
      values.push(sessionId);
      await this.storageService.query(
        `UPDATE exam_sessions SET ${setClauses.join(", ")} WHERE id = $${paramCount}`,
        values
      );
    }
  }

  /**
   * Get exam session with topic and scenario
   */
  async getExamSession(sessionId: string): Promise<ExamSession & { scenario?: string } | null> {
    const result = await this.storageService.query(
      `SELECT id, student_name, language, topic, scenario, status, turn_count, started_at
       FROM exam_sessions WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      studentName: row.student_name,
      language: row.language,
      topic: row.topic,
      scenario: row.scenario,
      status: row.status,
      turnCount: row.turn_count,
      startedAt: row.started_at,
    };
  }

  /**
   * Generate Socratic question based on student response
   *
   * Core Socratic techniques:
   * 1. Clarification - "What do you mean by...?"
   * 2. Probing assumptions - "What are you assuming when you say...?"
   * 3. Probing reasons/evidence - "What evidence supports...?"
   * 4. Questioning viewpoints - "How might someone with a different view respond?"
   * 5. Probing implications - "If that were true, what would follow?"
   * 6. Questioning the question - "Why is this question important?"
   */
  async generateSocraticQuestion(context: SocraticContext): Promise<string> {
    const {
      studentResponse,
      conversationHistory,
      ragResults,
      emotionalContext,
      turnCount,
      language,
      topic,
      scenario,
    } = context;

    // Build conversation context
    const recentHistory = conversationHistory.slice(-10).map(m =>
      `${m.role === "user" ? "Student" : "Examiner"}: ${m.content}`
    ).join("\n");

    // Build RAG context if available
    const ragContext = ragResults && ragResults.length > 0
      ? `RELEVANT MATERIALS:\n${ragResults.slice(0, 3).map((r: any, i: number) => {
        const title = r.chunk?.metadata?.title || "Source";
        const content = r.chunk?.content?.substring(0, 400) || "";
        return `[${i + 1}] ${title}:\n${content}`;
      }).join("\n\n")}`
      : "";

    // Build emotional context for adaptive questioning
    let emotionalGuidance = "";
    if (emotionalContext) {
      const { confidence, fluency, detectedEmotions } = emotionalContext;
      if (confidence === "uncertain" || confidence === "hesitant") {
        emotionalGuidance = "\nNote: Student appears uncertain. Use encouraging, scaffolding questions.";
      } else if (fluency === "struggling") {
        emotionalGuidance = "\nNote: Student is struggling with fluency. Keep questions simple and clear.";
      }
      if (detectedEmotions?.stress || detectedEmotions?.anxiety) {
        emotionalGuidance += "\nNote: Signs of stress detected. Be supportive while maintaining rigor.";
      }
    }

    const systemPrompt = `You are a Socratic examiner conducting an oral Critical Thinking assessment.
Your language of instruction: ${language.toUpperCase()}

ABSOLUTE RULES:
1. ONLY ask questions - NEVER provide answers, opinions, or direct information
2. NEVER say "that's correct" or "that's wrong" - only probe deeper
3. NEVER explain concepts - guide the student to discover them
4. Use the Socratic method exclusively
5. Respond in the student's language (${language})
6. Be culturally neutral - avoid culture-specific examples or assumptions

SOCRATIC TECHNIQUES:
- Clarification: "What do you mean by...?" "Can you elaborate on...?"
- Assumptions: "What are you assuming here?" "Is that assumption justified?"
- Evidence: "What evidence supports that?" "How do you know this?"
- Perspectives: "How might others view this differently?" "What objections might arise?"
- Implications: "What follows from this reasoning?" "What are the consequences?"
- Meta-questions: "Why is this question important?" "What would change your view?"

CRITICAL THINKING ASSESSMENT CRITERIA (Cambridge A-Level):
- AO1 (40%): Analysing arguments - identifying premises leading to conclusions
- AO2 (60%): Evaluating claims, judging relevance, assessing reasoning strength
- AO3: Constructing coherent arguments, forming well-reasoned judgements

${topic ? `CURRENT TOPIC: ${topic}` : ""}

${scenario ? `THE SCENARIO (this is exactly what the student was shown to analyze):
---
${scenario}
---
IMPORTANT: Your questions MUST be about THIS specific scenario. Do not ask about other topics.` : ""}

TURN COUNT: ${turnCount}
${turnCount === 1 ? "FIRST QUESTION: The student has just indicated they are ready. Ask your FIRST analytical question about the scenario above. Start by asking them to identify key claims, arguments, or assumptions in the scenario." : ""}
${turnCount >= 2 && turnCount < 4 ? "Early in session - explore initial understanding of the scenario, probe their analysis" : ""}
${turnCount >= 4 && turnCount < 8 ? "Mid-session - probe deeper, challenge assumptions, test evaluation skills" : ""}
${turnCount >= 8 ? "Later session - push for synthesis, judgement formation, and argument construction" : ""}

${ragContext}
${emotionalGuidance}

RESPONSE FORMAT:
- Ask 1-2 focused Socratic questions
- Questions should probe the specific reasoning the student just expressed
- Build on their response, don't ignore what they said
- Keep questions clear and accessible`;

    const userPrompt = `CONVERSATION SO FAR:
${recentHistory}

STUDENT'S LATEST RESPONSE:
"${studentResponse}"

Generate your next Socratic question(s) to probe deeper into the student's reasoning.
Remember: Ask questions ONLY. Never provide answers or evaluations.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: 500,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      return response.choices[0]?.message?.content ||
        "Can you tell me more about your reasoning?";
    } catch (error) {
      console.error("[Cortex] Socratic question generation error:", error);
      return "That's interesting. Can you explain your reasoning further?";
    }
  }

  /**
   * Generate opening question for a new topic
   */
  async generateOpeningQuestion(topic: string, language: string, ragResults?: any[]): Promise<string> {
    const ragContext = ragResults && ragResults.length > 0
      ? `SCENARIO MATERIALS:\n${ragResults.slice(0, 2).map((r: any, i: number) => {
        const content = r.chunk?.content?.substring(0, 600) || "";
        return `[${i + 1}] ${content}`;
      }).join("\n\n")}`
      : "";

    const systemPrompt = `You are a Socratic examiner beginning a Critical Thinking assessment.
Language of instruction: ${language.toUpperCase()}

Your task: Present a real-world scenario and ask an opening question that invites the student to begin their analysis.

REQUIREMENTS:
1. Present the scenario briefly and clearly
2. Ask an open-ended question that invites analytical thinking
3. The scenario should be culturally neutral
4. Do NOT provide any hints about "correct" answers
5. Respond in the student's language (${language})

${ragContext}

TOPIC: ${topic}

Generate an engaging opening that presents the scenario and asks the student to begin their analysis.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: 600,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate an opening question for the topic: "${topic}"` },
        ],
      });

      return response.choices[0]?.message?.content ||
        `Let's explore the topic of "${topic}". What are your initial thoughts?`;
    } catch (error) {
      console.error("[Cortex] Opening question generation error:", error);
      return `Let's examine the topic of "${topic}". What comes to mind when you consider this?`;
    }
  }

  /**
   * Save conversation message to history
   */
  async saveMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    metadata?: any
  ): Promise<void> {
    await this.storageService.saveConversationMessage({
      sessionId,
      role,
      content,
      metadata: metadata || {},
    });
  }

  /**
   * Get conversation history for context
   */
  async getConversationHistory(
    sessionId: string,
    limit: number = 20
  ): Promise<Array<{ role: string; content: string; createdAt: Date }>> {
    return await this.storageService.getConversationHistory(
      sessionId,
      limit
    );
  }

  /**
   * Create initial state for LangGraph from student message
   */
  createInitialState(
    sessionId: string,
    studentMessage: string,
    language: string = "en",
    topic?: string
  ): Partial<VocalAIStateType> {
    return {
      sessionId,
      currentUserMessage: studentMessage,
      language,
      topic,
      turnCount: 0,
      messages: [
        {
          role: "user",
          content: studentMessage,
          timestamp: new Date(),
        },
      ],
      executionLog: [],
    };
  }

  /**
   * Tool-calling model and tools (initialized by graph)
   */
  private toolModel?: any;
  private tools: any[] = [];
  private toolNode?: any;

  initializeTools(tools: any[], model: any, toolNode: any) {
    this.tools = tools;
    this.toolModel = model;
    this.toolNode = toolNode;
  }

  /**
   * Process state with tool-calling for RAG search
   */
  async processWithTools(state: VocalAIStateType): Promise<{ finalResponse: string; toolCalls: any[] }> {
    const startTime = Date.now();
    console.log("[Cortex] Starting Socratic examiner processing...");

    // Extract context from state
    const studentMessage = state.currentUserMessage;
    const language = state.language || "en";
    const topic = state.topic;
    const scenario = state.scenario; // The full scenario text presented to the student
    const turnCount = state.turnCount || 0;

    // Get conversation history
    const history = state.conversationHistory || [];

    // Build emotional context from state if available
    const emotionalContext = state.emotionalContext ? {
      confidence: state.studentEmotionalState?.confidenceLevel,
      fluency: state.studentEmotionalState?.fluencyAssessment,
      detectedEmotions: state.emotionalContext.audio || state.emotionalContext.video,
    } : undefined;

    // If we have tools and a topic, search for relevant materials
    let ragResults: any[] = [];
    const toolCallLog: any[] = [];

    if (this.toolNode && this.tools.length > 0 && topic) {
      console.log("[Cortex] Searching knowledge base for topic materials...");

      try {
        // Find the search_knowledge tool
        const searchTool = this.tools.find(t => t.name === "search_knowledge");
        if (searchTool) {
          const searchQuery = `${topic} ${studentMessage.substring(0, 100)}`;
          const searchResult = await searchTool.invoke({ query: searchQuery, topK: 5 });
          const parsed = JSON.parse(searchResult);

          if (parsed.results && parsed.results.length > 0) {
            ragResults = parsed.results.map((r: any) => ({
              chunk: { content: r.content, metadata: { title: r.title } },
              score: parseFloat(r.relevance) / 100,
            }));
            toolCallLog.push({ tool: "search_knowledge", args: { query: searchQuery, topK: 5 } });
            console.log(`[Cortex] Found ${ragResults.length} relevant materials`);
          }
        }
      } catch (error) {
        console.error("[Cortex] RAG search error:", error);
      }
    }

    // Generate Socratic question
    const context: SocraticContext = {
      sessionId: state.sessionId,
      studentResponse: studentMessage,
      conversationHistory: history,
      ragResults,
      emotionalContext,
      turnCount,
      language,
      topic,
      scenario, // Pass the full scenario text to the question generator
    };

    // Generate Socratic question (turn 0 is handled by ExamPrep agent)
    const response = await this.generateSocraticQuestion(context);

    console.log(`[Cortex] Generated Socratic question in ${Date.now() - startTime}ms`);

    // Emit progress event
    EventBus.getInstance().emitProgress({
      type: "socratic_question",
      turnCount: turnCount + 1,
      timestamp: Date.now(),
    });

    return { finalResponse: response, toolCalls: toolCallLog };
  }

  /**
   * Extract final response from state
   */
  extractFinalResponse(state: VocalAIStateType): string {
    return state.finalResponse || "Can you elaborate on that point?";
  }

  /**
   * End exam session and trigger final report generation
   */
  async endExamSession(sessionId: string): Promise<void> {
    await this.updateExamSession(sessionId, { status: "completed" });
    console.log(`[Cortex] Exam session ${sessionId} completed`);

    // Emit event for report generation
    EventBus.getInstance().emit("exam_completed", { sessionId });
  }
}
