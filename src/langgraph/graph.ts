import { StateGraph, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { VocalAIState, VocalAIStateType } from "./state";
import { PostgresService } from "../storage";
import { VectorIndexService } from "../vector-index";
import { LimbicAgent } from "../agents/limbic";
import { Cortex } from "../agents/cortex";
import { LogicAgent } from "../agents/logic";
import { Insula } from "../agents/insula";
import { ExamPrepAgent } from "../agents/exam-prep";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { EventBus } from "../event-bus";
import {
  createSearchKnowledgeTool,
  createClearConversationHistoryTool,
  createSearchConversationHistoryTool,
  createGetConversationTimelineTool,
  createCalculateNextDayTool,
  createWebFetchTool,
} from "../tools";

/**
 * Vocal AI Examination Graph
 *
 * 3-node graph for Socratic Critical Thinking examinations:
 * 1. ExamPrep - Handles turn 0: assesses cultural preferences, fetches RAG scenarios, begins exam
 * 2. Cortex - Socratic examiner for turns 1+ (generates questions, never answers)
 * 3. Insula - Safety guardrails (ensures Socratic method compliance)
 *
 * Async agents (fire-and-forget, don't block dialog):
 * - Logic - CT skill assessment (stores scores to database)
 * - Limbic - Emotional state tracking (stores to database)
 *
 * Flow:
 * Turn 0: Student Cultural Preferences -> ExamPrep (assess, RAG, begin exam) -> Insula -> Student
 * Turn 1+: Student Response -> Cortex (Socratic question) -> Insula (safety) -> Student
 */

export class VocalAIGraph {
  private graph: StateGraph<typeof VocalAIState>;
  private compiledGraph: any;
  private insula: Insula;
  private cortex: Cortex;
  private examPrepAgent: ExamPrepAgent;
  private logicAgent: LogicAgent;
  private limbicAgent: LimbicAgent;

  constructor(
    private storage: PostgresService,
    private vectorService: VectorIndexService,
    openaiApiKey?: string
  ) {
    // Initialize agents
    this.insula = new Insula(openaiApiKey);
    this.cortex = new Cortex(storage, openaiApiKey);
    this.examPrepAgent = new ExamPrepAgent(storage, vectorService, openaiApiKey);
    this.logicAgent = new LogicAgent(storage, openaiApiKey);
    this.limbicAgent = new LimbicAgent(storage, openaiApiKey);

    // Initialize Cortex with RAG tools
    this.initializeCortexTools(openaiApiKey);

    // Build graph with conditional routing based on turn count
    // Turn 0: examPrep -> insula -> END (cultural preferences -> begin exam)
    // Turn 1+: cortex -> insula -> END (Socratic dialogue)
    this.graph = new StateGraph(VocalAIState);

    // Add nodes
    this.graph.addNode("router", this.routerNode.bind(this));
    this.graph.addNode("examPrep", this.examPrepNode.bind(this));
    this.graph.addNode("cortex", this.cortexNode.bind(this));
    this.graph.addNode("insula", this.insulaNode.bind(this));

    // Set entry point to router
    this.graph.setEntryPoint("router" as any);

    // Router conditionally routes to examPrep (turn 0) or cortex (turn 1+)
    this.graph.addConditionalEdges("router" as any, this.routeByTurn.bind(this), {
      examPrep: "examPrep",
      cortex: "cortex",
    });

    // Both examPrep and cortex lead to insula for safety check
    this.graph.addEdge("examPrep" as any, "insula" as any);
    this.graph.addEdge("cortex" as any, "insula" as any);
    this.graph.addEdge("insula" as any, END);
  }

  /**
   * Route based on turn count: turn 0 goes to examPrep, turn 1+ goes to cortex
   */
  private routeByTurn(state: VocalAIStateType): string {
    const turnCount = state.turnCount || 0;
    console.log(`[Router] Turn ${turnCount} - routing to ${turnCount === 0 ? "examPrep" : "cortex"}`);
    return turnCount === 0 ? "examPrep" : "cortex";
  }

  /**
   * Router node - just passes through, routing is done by conditional edges
   */
  private async routerNode(state: VocalAIStateType): Promise<Partial<VocalAIStateType>> {
    return {};
  }

  /**
   * Initialize PostgreSQL checkpointer and compile graph
   */
  async initialize(): Promise<void> {
    const { user, password, host, port, database, ssl } = this.storage.config;

    // Build connection string with SSL if needed
    let connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}`;

    // Add SSL parameter for Render PostgreSQL
    if (ssl) {
      connectionString += '?sslmode=require';
    }

    const checkpointer = PostgresSaver.fromConnString(connectionString);
    await checkpointer.setup();

    this.compiledGraph = this.graph.compile({ checkpointer });
    console.log("[VocalAI Graph] Initialized with PostgreSQL checkpointer");
  }

  /**
   * Initialize Cortex with knowledge search tools
   */
  private initializeCortexTools(openaiApiKey?: string) {
    const tools = [
      createSearchKnowledgeTool(this.vectorService),
      createClearConversationHistoryTool(this.storage),
      createSearchConversationHistoryTool(this.storage),
      createGetConversationTimelineTool(this.storage),
      createCalculateNextDayTool(),
      createWebFetchTool(),
    ];

    const cortexModel = new ChatOpenAI({
      openAIApiKey: openaiApiKey || process.env.OPENAI_API_KEY,
      modelName: process.env.LLM_MODEL || "gpt-4o-mini",
      temperature: 0.7,
    }).bindTools(tools);

    const cortexToolNode = new ToolNode(tools);

    this.cortex.initializeTools(tools, cortexModel, cortexToolNode);
  }

  /**
   * ExamPrep Node - Handles turn 0 (cultural preferences assessment and exam start)
   *
   * 1. Assesses cultural preferences from student's response
   * 2. Searches RAG database for appropriate CT scenarios
   * 3. Generates topic introduction, scenario, and opening question
   */
  private async examPrepNode(
    state: VocalAIStateType
  ): Promise<Partial<VocalAIStateType>> {
    const startTime = Date.now();

    EventBus.getInstance().emitProgress({
      type: "agent_start",
      agent: "examPrep",
      action: "exam_preparation",
      timestamp: Date.now(),
    });

    try {
      console.log("[ExamPrep] Processing cultural preferences and preparing exam...");

      // Call ExamPrep agent to:
      // 1. Assess cultural preferences
      // 2. Search RAG for scenarios
      // 3. Generate opening (topic intro, scenario, ready prompt)
      const prepResult = await this.examPrepAgent.prepareExam(
        state.currentUserMessage || "",
        state.language || "en"
      );

      console.log(`[ExamPrep] Exam prepared in ${Date.now() - startTime}ms`);
      console.log(`[ExamPrep] Topic: ${prepResult.topic}`);

      // Emit event with scenario for display (separate from spoken response)
      EventBus.getInstance().emit("exam_scenario", {
        topic: prepResult.topic,
        scenario: prepResult.displayedScenario,
        timestamp: Date.now(),
      });

      return {
        // spokenResponse is what gets sent to TTS (topic intro + ready prompt, NOT the scenario)
        finalResponse: prepResult.spokenResponse,
        culturalPreferences: prepResult.culturalPreferences,
        topic: prepResult.topic,
        scenario: prepResult.scenario, // Pass the actual scenario content to Cortex
        ragResults: prepResult.ragResults,
        turnCount: 1, // Move to turn 1 after exam prep
        executionLog: [
          {
            agent: "examPrep",
            action: "exam_prepared",
            timestamp: new Date(),
            result: {
              topic: prepResult.topic,
              displayedScenario: prepResult.displayedScenario,
              culturalPreferencesAssessed: prepResult.culturalPreferences.assessed,
              ragResultsCount: prepResult.ragResults.length,
            },
          },
        ],
      };
    } catch (error) {
      console.error("[ExamPrep] Error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Fallback - spoken response (no questions yet)
      const fallbackSpoken = `Thank you. Let's begin the examination.

Today we will be examining your critical thinking skills through argument analysis.

Here is your topic. Please read it carefully on screen.

When you are ready to begin answering questions about it, just let me know.`;

      // Fallback scenario for display
      const fallbackScenario = `EXAMINATION TOPIC: Critical Analysis

Consider the following argument: 'Since most successful people wake up early, waking up early must be a key factor in success.' A business magazine recently published this claim based on interviews with 50 CEOs.`;

      EventBus.getInstance().emit("exam_scenario", {
        topic: "Critical Analysis",
        scenario: fallbackScenario,
        timestamp: Date.now(),
      });

      return {
        finalResponse: fallbackSpoken,
        topic: "Critical Analysis",
        turnCount: 1,
        executionLog: [
          {
            agent: "examPrep",
            action: "error_fallback",
            timestamp: new Date(),
            result: { error: errorMessage },
          },
        ],
      };
    }
  }

  /**
   * Cortex Node - Socratic Examiner
   *
   * Demo mode: After 3 question turns (turnCount 2, 3, 4), end the exam
   * Turn 0: Cultural preferences (ExamPrep)
   * Turn 1: First question (Cortex) - student says "ready"
   * Turn 2: Second question (Cortex) - first actual answer
   * Turn 3: Third question (Cortex) - second actual answer
   * Turn 4: End exam and show assessment
   */
  private async cortexNode(
    state: VocalAIStateType
  ): Promise<Partial<VocalAIStateType>> {
    const startTime = Date.now();
    const MAX_QUESTION_TURNS = 4; // End after turn 4 (0=ExamPrep, 1-3=Cortex questions, 4=Final assessment)

    EventBus.getInstance().emitProgress({
      type: "agent_start",
      agent: "cortex",
      action: "socratic_questioning",
      timestamp: Date.now(),
    });

    try {
      // Fire-and-forget: Trigger async CT assessment (Logic agent) FIRST
      // So it runs before we potentially end the exam
      if (state.turnCount > 1 && state.currentUserMessage) {
        const lastExaminerQuestion = state.conversationHistory
          ?.slice(-2)
          .find(m => m.role === "assistant")?.content || "";

        this.logicAgent.assessResponseAsync({
          sessionId: state.sessionId,
          turnNumber: state.turnCount,
          examinerQuestion: lastExaminerQuestion,
          studentResponse: state.currentUserMessage,
          conversationHistory: state.conversationHistory,
          topic: state.topic,
        });
      }

      // Fire-and-forget: Trigger async emotional state tracking (Limbic agent)
      if (state.currentUserMessage) {
        this.limbicAgent.assessEmotionalStateAsync({
          sessionId: state.sessionId,
          turnNumber: state.turnCount || 0,
          studentResponse: state.currentUserMessage,
          humeEmotions: state.emotionalContext?.audio,
          videoAnalysis: state.emotionalContext?.video,
        });
      }

      // Check if we should end the exam (after MAX_QUESTION_TURNS)
      if (state.turnCount >= MAX_QUESTION_TURNS) {
        console.log(`[Cortex] Demo complete - ending exam after ${state.turnCount} turns`);

        // Generate final assessment report
        const report = await this.logicAgent.generateSessionReport(state.sessionId);

        // Emit exam complete event with report
        EventBus.getInstance().emit("exam_complete", {
          sessionId: state.sessionId,
          report,
          timestamp: Date.now(),
        });

        const closingMessage = `Thank you. That is the end of your exam. Your assessment will follow shortly.

---

Based on your responses, here is your performance summary:

Overall Grade: ${report.gradeRecommendation}
Average Score: ${report.averageScores.overallScore}%

${report.strengths.length > 0 ? `Strengths: ${report.strengths.join(", ")}` : ""}
${report.areasForImprovement.length > 0 ? `Areas for Development: ${report.areasForImprovement.join(", ")}` : ""}

${report.summary}

This concludes your examination. Well done for engaging with these challenging questions.`;

        return {
          finalResponse: closingMessage,
          isFinalAssessment: true, // Skip TTS for final assessment
          turnCount: state.turnCount + 1,
          executionLog: [
            {
              agent: "cortex",
              action: "exam_completed",
              timestamp: new Date(),
              result: {
                grade: report.gradeRecommendation,
                overallScore: report.averageScores.overallScore,
              },
            },
          ],
        };
      }

      // Normal flow: generate Socratic question
      const { finalResponse, toolCalls } = await this.cortex.processWithTools(state);

      console.log(`[Cortex] Socratic question generated in ${Date.now() - startTime}ms`);

      return {
        finalResponse,
        toolCalls,
        turnCount: (state.turnCount || 0) + 1,
        executionLog: [
          {
            agent: "cortex",
            action: "socratic_question",
            timestamp: new Date(),
            result: {
              toolCallsMade: toolCalls.length,
              responseLength: finalResponse.length,
            },
          },
        ],
      };
    } catch (error) {
      console.error("[Cortex] Error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        finalResponse: "Can you elaborate on your reasoning?",
        executionLog: [
          {
            agent: "cortex",
            action: "error",
            timestamp: new Date(),
            result: { error: errorMessage },
          },
        ],
      };
    }
  }

  /**
   * Insula Node - Safety Guardrails
   * Ensures examiner stays in Socratic dialog mode
   */
  private async insulaNode(
    state: VocalAIStateType
  ): Promise<Partial<VocalAIStateType>> {
    const startTime = Date.now();

    EventBus.getInstance().emitProgress({
      type: "agent_start",
      agent: "insula",
      action: "safety_check",
      timestamp: Date.now(),
    });

    // Skip validation for final assessment (contains grades/feedback by design)
    if (state.isFinalAssessment) {
      console.log("[Insula] Skipping validation for final assessment");
      return {};
    }

    if (!state.finalResponse) {
      console.log("[Insula] No response to check");
      return {};
    }

    const safetyAssessment = await this.insula.assessResponse(
      state.finalResponse,
      state.currentUserMessage
    );

    if (safetyAssessment.safetyLevel === "safe" || safetyAssessment.safetyLevel === "caution") {
      console.log(`[Insula] Response approved (${safetyAssessment.safetyLevel}) in ${Date.now() - startTime}ms`);
      return {
        safetyAssessment,
        executionLog: [
          {
            agent: "insula",
            action: "response_approved",
            timestamp: new Date(),
            result: { safetyLevel: safetyAssessment.safetyLevel },
          },
        ],
      };
    }

    // Intervene - replace with corrected Socratic question
    const correctedResponse = safetyAssessment.recommendedResponse ||
      this.insula.getFallbackQuestion();

    console.log(`[Insula] Intervention (${safetyAssessment.safetyLevel}): ${safetyAssessment.concerns?.join(", ")}`);

    return {
      safetyAssessment,
      finalResponse: correctedResponse,
      executionLog: [
        {
          agent: "insula",
          action: `${safetyAssessment.safetyLevel}_intervention`,
          timestamp: new Date(),
          result: {
            boundaryType: safetyAssessment.boundaryType,
            concerns: safetyAssessment.concerns,
            originalBlocked: true,
          },
        },
      ],
    };
  }

  /**
   * Start a new exam session
   */
  async startExamSession(
    studentName?: string,
    language: string = "en"
  ): Promise<{ sessionId: string; language: string }> {
    const session = await this.cortex.createExamSession(studentName, language);
    return { sessionId: session.id, language: session.language };
  }

  /**
   * Invoke the graph with a student message
   */
  async invoke(input: {
    studentMessage: string;
    sessionId: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    language?: string;
    topic?: string;
    scenario?: string;
    turnCount?: number;
    emotionalContext?: {
      video: any | null;
      audio: any | null;
    };
  }): Promise<{
    response: string;
    turnCount: number;
    topic?: string;
    scenario?: string;
    executionLog: any[];
    isFinalAssessment?: boolean;
  }> {
    const startTime = Date.now();

    const {
      studentMessage,
      sessionId,
      conversationHistory = [],
      language = "en",
      topic,
      scenario,
      turnCount = 0,
      emotionalContext,
    } = input;

    console.log("\n========================================");
    console.log("[VocalAI] New student message");
    console.log(`[VocalAI] Session: ${sessionId}`);
    console.log(`[VocalAI] Turn: ${turnCount}`);
    console.log(`[VocalAI] Message: ${studentMessage.substring(0, 100)}...`);
    console.log("========================================\n");

    // Auto-detect language on first message
    let detectedLanguage = language;
    if (turnCount === 0) {

      detectedLanguage = await this.cortex.detectLanguage(studentMessage);
      await this.cortex.updateExamSession(sessionId, { language: detectedLanguage });
      console.log(`[VocalAI] Detected language: ${detectedLanguage}`);

    }

    const config = { configurable: { thread_id: sessionId } };

    const stateUpdate: Partial<VocalAIStateType> = {
      sessionId,
      currentUserMessage: studentMessage,
      conversationHistory,
      language: detectedLanguage,
      topic,
      scenario,
      turnCount,
      emotionalContext,
      messages: [
        {
          role: "user",
          content: studentMessage,
          timestamp: new Date(),
        },
      ],
      executionLog: [],
      finalResponse: undefined,
    };

    const finalState = await this.compiledGraph.invoke(stateUpdate, config);

    const responseText = finalState.finalResponse ||
      "Can you tell me more about your reasoning?";

    // Save to conversation history
    await this.cortex.saveMessage(sessionId, "user", studentMessage);
    await this.cortex.saveMessage(sessionId, "assistant", responseText);

    // Update session - save turn count, and topic/scenario if set by ExamPrep
    const sessionUpdates: { turnCount: number; topic?: string; scenario?: string } = {
      turnCount: (turnCount || 0) + 1,
    };

    // Persist topic and scenario to database when they're set (turn 0 -> 1 transition)
    if (finalState.topic && !topic) {
      sessionUpdates.topic = finalState.topic;
    }
    if (finalState.scenario && !scenario) {
      sessionUpdates.scenario = finalState.scenario;
    }

    await this.cortex.updateExamSession(sessionId, sessionUpdates);

    console.log(`[VocalAI] Response generated in ${Date.now() - startTime}ms`);

    return {
      response: responseText,
      turnCount: finalState.turnCount || (turnCount || 0) + 1,
      topic: finalState.topic || topic,
      scenario: finalState.scenario || scenario,
      executionLog: finalState.executionLog || [],
      isFinalAssessment: finalState.isFinalAssessment || false,
    };
  }

  /**
   * End exam session and generate report
   */
  async endExamSession(sessionId: string): Promise<{
    summary: string;
    averageScores: any;
    gradeRecommendation: string;
    strengths: string[];
    areasForImprovement: string[];
    emotionalSummary: any;
  }> {
    // Mark session as completed
    await this.cortex.endExamSession(sessionId);

    // Generate CT assessment report
    const ctReport = await this.logicAgent.generateSessionReport(sessionId);

    // Generate emotional state summary
    const emotionalSummary = await this.limbicAgent.generateEmotionalSummary(sessionId);

    return {
      summary: ctReport.summary,
      averageScores: ctReport.averageScores,
      gradeRecommendation: ctReport.gradeRecommendation,
      strengths: ctReport.strengths,
      areasForImprovement: ctReport.areasForImprovement,
      emotionalSummary,
    };
  }

  /**
   * Get full exam transcript
   */
  async getExamTranscript(sessionId: string): Promise<{
    dialog: Array<{ role: string; content: string; timestamp: Date }>;
    assessments: any[];
    emotionalStates: any[];
  }> {
    const dialog = await this.cortex.getConversationHistory(sessionId, 100);
    const assessments = await this.logicAgent.getSessionAssessments(sessionId);
    const emotionalStates = await this.limbicAgent.getSessionEmotionalHistory(sessionId);

    return { dialog, assessments, emotionalStates };
  }

  /**
   * Check if student needs support
   */
  async checkStudentSupport(sessionId: string): Promise<{
    needed: boolean;
    type: string;
    message?: string;
  }> {
    return await this.limbicAgent.checkSupportNeeded(sessionId);
  }

  /**
   * Get Logic agent for report generation
   */
  getLogicAgent(): LogicAgent {
    return this.logicAgent;
  }

  /**
   * Get Limbic agent for emotional tracking
   */
  getLimbicAgent(): LimbicAgent {
    return this.limbicAgent;
  }

  /**
   * Get Cortex agent for session management
   */
  getCortexAgent(): Cortex {
    return this.cortex;
  }
}

// Legacy export for backward compatibility
export { VocalAIGraph as NiimiGraph };
