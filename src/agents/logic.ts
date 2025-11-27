import OpenAI from "openai";
import { PostgresService } from "../storage";
import { VocalAIStateType, CTAssessment } from "../langgraph/state";
import { parseJsonFromLLM } from "../utils/json-parser";
import { EventBus } from "../event-bus";

/**
 * Logic Agent - Critical Thinking Assessment
 *
 * Async assessment agent that evaluates student responses against
 * Cambridge A-Level Critical Thinking criteria.
 *
 * Invocation Pattern:
 * - Called ASYNCHRONOUSLY after each student turn (fire-and-forget)
 * - Does NOT block the Socratic dialog flow
 * - Stores assessment results directly to database
 *
 * Assessment Criteria (Cambridge A-Level CT):
 * AO1 (40%): Analysing and evaluating arguments
 *   - Identifying premises leading to conclusions
 *   - Judging relevance and significance of information
 *
 * AO2 (60%): Creating and communicating reasoning
 *   - Evaluating claims, inferences, arguments, explanations
 *   - Constructing clear and coherent arguments
 *   - Forming well-reasoned judgements and decisions
 *
 * Scoring: 0-100 per skill, with examiner notes
 */

export interface CTSkillScores {
  analysingArguments: number;    // AO1: Identifying premises and conclusions
  judgingRelevance: number;      // AO2: Identifying relevant information
  evaluatingClaims: number;      // AO2: Evaluating claims/inferences/explanations
  constructingArguments: number; // AO3: Constructing clear arguments
  formingJudgements: number;     // AO3: Forming well-reasoned judgements
  overallScore: number;          // Weighted average
  examinerNotes: string;         // Detailed feedback
}

export interface AssessmentContext {
  sessionId: string;
  turnNumber: number;
  examinerQuestion: string;
  studentResponse: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  topic?: string;
}

export class LogicAgent {
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
   * Assess student response against CT criteria
   * Called asynchronously - does not block dialog
   *
   * @param context Assessment context including question/response
   * @returns CT skill scores and notes
   */
  async assessResponse(context: AssessmentContext): Promise<CTSkillScores> {
    const {
      sessionId,
      turnNumber,
      examinerQuestion,
      studentResponse,
      conversationHistory,
      topic,
    } = context;

    console.log(`[Logic] Assessing turn ${turnNumber} for session ${sessionId}...`);

    // Build conversation context for assessment
    const dialogContext = conversationHistory && conversationHistory.length > 0
      ? conversationHistory.slice(-6).map(m =>
          `${m.role === "user" ? "Student" : "Examiner"}: ${m.content}`
        ).join("\n\n")
      : "";

    const systemPrompt = `You are an expert Critical Thinking examiner assessing student responses.
Your role is to evaluate the student's reasoning against Cambridge A-Level Critical Thinking criteria.

ASSESSMENT CRITERIA:

AO1: Analysing Arguments (Weight: 20%)
- Identifying premises (facts, opinions, beliefs) leading to conclusions
- Understanding argument structure
- Recognizing assumptions
Score 0-100 based on: How well does the student identify and analyze arguments?

AO2.1: Judging Relevance (Weight: 20%)
- Identifying relevant vs irrelevant information
- Understanding the significance of evidence
- Recognizing what supports or weakens claims
Score 0-100 based on: How well does the student judge what information is relevant?

AO2.2: Evaluating Claims (Weight: 20%)
- Assessing the strength of claims and inferences
- Identifying flaws in reasoning
- Evaluating explanations and conclusions
Score 0-100 based on: How well does the student evaluate claims and evidence?

AO3.1: Constructing Arguments (Weight: 20%)
- Building clear, logical arguments
- Using evidence effectively
- Structuring reasoning coherently
Score 0-100 based on: How well does the student construct their own arguments?

AO3.2: Forming Judgements (Weight: 20%)
- Reaching well-reasoned conclusions
- Weighing competing considerations
- Making justified decisions
Score 0-100 based on: How well does the student form their own judgements?

SCORING GUIDE:
- 90-100: Exceptional - sophisticated, nuanced reasoning
- 75-89: Strong - clear reasoning with minor gaps
- 60-74: Competent - adequate reasoning, some development needed
- 45-59: Developing - basic reasoning, significant gaps
- 30-44: Weak - limited reasoning, major improvements needed
- 0-29: Insufficient - minimal or no critical thinking demonstrated

IMPORTANT:
- Assess the REASONING quality, not the correctness of conclusions
- Consider fluency limitations (ESL students) - focus on thinking, not language
- Be culturally neutral in your assessment
- Provide constructive, specific feedback

${topic ? `TOPIC: ${topic}` : ""}`;

    const userPrompt = `PRIOR DIALOG CONTEXT:
${dialogContext}

EXAMINER'S QUESTION:
"${examinerQuestion}"

STUDENT'S RESPONSE:
"${studentResponse}"

Assess this response against the CT criteria. Return JSON:
{
  "analysingArguments": <0-100>,
  "judgingRelevance": <0-100>,
  "evaluatingClaims": <0-100>,
  "constructingArguments": <0-100>,
  "formingJudgements": <0-100>,
  "overallScore": <0-100>,
  "examinerNotes": "<detailed assessment with specific observations about strengths and areas for improvement>"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini", // Use faster model for assessment
        max_tokens: 1000,
        temperature: 0.3, // Lower temperature for consistent assessment
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = parseJsonFromLLM(content);

      // Calculate weighted overall score if not provided
      const scores: CTSkillScores = {
        analysingArguments: parsed.analysingArguments ?? 50,
        judgingRelevance: parsed.judgingRelevance ?? 50,
        evaluatingClaims: parsed.evaluatingClaims ?? 50,
        constructingArguments: parsed.constructingArguments ?? 50,
        formingJudgements: parsed.formingJudgements ?? 50,
        overallScore: parsed.overallScore ?? this.calculateOverallScore(parsed),
        examinerNotes: parsed.examinerNotes || "Assessment completed.",
      };

      // Store assessment in database
      await this.storeAssessment(sessionId, turnNumber, examinerQuestion, studentResponse, scores);

      // Detailed logging for visibility
      const green = '\x1b[32m';
      const reset = '\x1b[0m';
      console.log(`${green}[Logic] CT Assessment Complete for Turn ${turnNumber}${reset}`);
      console.log(`${green}  Session: ${sessionId}${reset}`);
      console.log(`${green}  Overall Score: ${scores.overallScore}%${reset}`);
      console.log(`${green}  - Analysing Arguments: ${scores.analysingArguments}%${reset}`);
      console.log(`${green}  - Judging Relevance: ${scores.judgingRelevance}%${reset}`);
      console.log(`${green}  - Evaluating Claims: ${scores.evaluatingClaims}%${reset}`);
      console.log(`${green}  - Constructing Arguments: ${scores.constructingArguments}%${reset}`);
      console.log(`${green}  - Forming Judgements: ${scores.formingJudgements}%${reset}`);
      console.log(`${green}  Notes: ${scores.examinerNotes.substring(0, 100)}...${reset}\n`);

      // Emit assessment to frontend via EventBus
      EventBus.getInstance().emit('ct_assessment', {
        sessionId,
        turnNumber,
        scores,
        timestamp: Date.now(),
      });

      return scores;

    } catch (error) {
      console.error("[Logic] Assessment error:", error);

      // Return default scores on error
      const defaultScores: CTSkillScores = {
        analysingArguments: 50,
        judgingRelevance: 50,
        evaluatingClaims: 50,
        constructingArguments: 50,
        formingJudgements: 50,
        overallScore: 50,
        examinerNotes: "Assessment could not be completed due to an error.",
      };

      return defaultScores;
    }
  }

  /**
   * Calculate weighted overall score from individual skill scores
   */
  private calculateOverallScore(scores: any): number {
    const weights = {
      analysingArguments: 0.20,
      judgingRelevance: 0.20,
      evaluatingClaims: 0.20,
      constructingArguments: 0.20,
      formingJudgements: 0.20,
    };

    let total = 0;
    let weightSum = 0;

    for (const [skill, weight] of Object.entries(weights)) {
      if (scores[skill] !== undefined) {
        total += scores[skill] * weight;
        weightSum += weight;
      }
    }

    return Math.round(weightSum > 0 ? total / weightSum * (1 / weightSum) : 50);
  }

  /**
   * Store assessment results in database
   */
  private async storeAssessment(
    sessionId: string,
    turnNumber: number,
    examinerQuestion: string,
    studentResponse: string,
    scores: CTSkillScores
  ): Promise<void> {
    try {
      await this.storageService.query(
        `INSERT INTO assessment_results (
          session_id,
          turn_number,
          examiner_question,
          student_response,
          analysing_arguments,
          judging_relevance,
          evaluating_claims,
          constructing_arguments,
          forming_judgements,
          overall_score,
          examiner_notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sessionId,
          turnNumber,
          examinerQuestion,
          studentResponse,
          scores.analysingArguments,
          scores.judgingRelevance,
          scores.evaluatingClaims,
          scores.constructingArguments,
          scores.formingJudgements,
          scores.overallScore,
          scores.examinerNotes,
        ]
      );
    } catch (error) {
      console.error("[Logic] Failed to store assessment:", error);
    }
  }

  /**
   * Get all assessments for a session
   */
  async getSessionAssessments(sessionId: string): Promise<CTAssessment[]> {
    const result = await this.storageService.query(
      `SELECT * FROM assessment_results
       WHERE session_id = $1
       ORDER BY turn_number ASC`,
      [sessionId]
    );

    return result.rows.map((row: any) => ({
      turnNumber: row.turn_number,
      examinerQuestion: row.examiner_question,
      studentResponse: row.student_response,
      analysingArguments: row.analysing_arguments,
      judgingRelevance: row.judging_relevance,
      evaluatingClaims: row.evaluating_claims,
      constructingArguments: row.constructing_arguments,
      formingJudgements: row.forming_judgements,
      overallScore: row.overall_score,
      examinerNotes: row.examiner_notes,
    }));
  }

  /**
   * Generate final session report
   * Called when exam session is completed
   */
  async generateSessionReport(sessionId: string): Promise<{
    summary: string;
    averageScores: CTSkillScores;
    gradeRecommendation: string;
    strengths: string[];
    areasForImprovement: string[];
  }> {
    const assessments = await this.getSessionAssessments(sessionId);

    if (assessments.length === 0) {
      return {
        summary: "No assessments recorded for this session.",
        averageScores: {
          analysingArguments: 0,
          judgingRelevance: 0,
          evaluatingClaims: 0,
          constructingArguments: 0,
          formingJudgements: 0,
          overallScore: 0,
          examinerNotes: "",
        },
        gradeRecommendation: "N/A",
        strengths: [],
        areasForImprovement: [],
      };
    }

    // Calculate average scores
    const avgScores: CTSkillScores = {
      analysingArguments: 0,
      judgingRelevance: 0,
      evaluatingClaims: 0,
      constructingArguments: 0,
      formingJudgements: 0,
      overallScore: 0,
      examinerNotes: "",
    };

    for (const a of assessments) {
      avgScores.analysingArguments += a.analysingArguments;
      avgScores.judgingRelevance += a.judgingRelevance;
      avgScores.evaluatingClaims += a.evaluatingClaims;
      avgScores.constructingArguments += a.constructingArguments;
      avgScores.formingJudgements += a.formingJudgements;
      avgScores.overallScore += a.overallScore;
    }

    const count = assessments.length;
    avgScores.analysingArguments = Math.round(avgScores.analysingArguments / count);
    avgScores.judgingRelevance = Math.round(avgScores.judgingRelevance / count);
    avgScores.evaluatingClaims = Math.round(avgScores.evaluatingClaims / count);
    avgScores.constructingArguments = Math.round(avgScores.constructingArguments / count);
    avgScores.formingJudgements = Math.round(avgScores.formingJudgements / count);
    avgScores.overallScore = Math.round(avgScores.overallScore / count);

    // Determine grade based on overall score
    const gradeRecommendation = this.determineGrade(avgScores.overallScore);

    // Identify strengths and areas for improvement
    const skillNames: { [key: string]: string } = {
      analysingArguments: "Analysing Arguments",
      judgingRelevance: "Judging Relevance",
      evaluatingClaims: "Evaluating Claims",
      constructingArguments: "Constructing Arguments",
      formingJudgements: "Forming Judgements",
    };

    const strengths: string[] = [];
    const areasForImprovement: string[] = [];

    for (const [skill, name] of Object.entries(skillNames)) {
      const score = avgScores[skill as keyof CTSkillScores] as number;
      if (score >= 70) {
        strengths.push(`${name} (${score}%)`);
      } else if (score < 50) {
        areasForImprovement.push(`${name} (${score}%)`);
      }
    }

    // Generate summary using LLM
    const summary = await this.generateSummary(assessments, avgScores, gradeRecommendation);

    return {
      summary,
      averageScores: avgScores,
      gradeRecommendation,
      strengths,
      areasForImprovement,
    };
  }

  /**
   * Determine grade based on score
   * Based on Cambridge A-Level grading scale
   */
  private determineGrade(score: number): string {
    if (score >= 90) return "A* (90-100)";
    if (score >= 80) return "A (80-89)";
    if (score >= 70) return "B (70-79)";
    if (score >= 60) return "C (60-69)";
    if (score >= 50) return "D (50-59)";
    if (score >= 40) return "E (40-49)";
    return "U (Below 40)";
  }

  /**
   * Generate narrative summary of session performance
   */
  private async generateSummary(
    assessments: CTAssessment[],
    avgScores: CTSkillScores,
    grade: string
  ): Promise<string> {
    const assessmentDetails = assessments.map((a, i) =>
      `Turn ${a.turnNumber}: Overall ${a.overallScore}% - ${a.examinerNotes.substring(0, 100)}...`
    ).join("\n");

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 500,
        temperature: 0.5,
        messages: [
          {
            role: "system",
            content: "You are an educational assessment expert writing a brief, constructive summary of a student's Critical Thinking oral examination performance.",
          },
          {
            role: "user",
            content: `Write a 2-3 paragraph summary of this student's performance:

OVERALL GRADE: ${grade}
AVERAGE SCORES:
- Analysing Arguments: ${avgScores.analysingArguments}%
- Judging Relevance: ${avgScores.judgingRelevance}%
- Evaluating Claims: ${avgScores.evaluatingClaims}%
- Constructing Arguments: ${avgScores.constructingArguments}%
- Forming Judgements: ${avgScores.formingJudgements}%

TURN-BY-TURN ASSESSMENT:
${assessmentDetails}

Write a constructive, encouraging summary that highlights strengths and provides specific, actionable suggestions for improvement.`,
          },
        ],
      });

      return response.choices[0]?.message?.content || "Summary generation failed.";
    } catch (error) {
      console.error("[Logic] Summary generation error:", error);
      return `Student achieved an overall grade of ${grade} with an average score of ${avgScores.overallScore}%.`;
    }
  }

  /**
   * Fire-and-forget assessment
   * Called by the main flow without awaiting
   */
  assessResponseAsync(context: AssessmentContext): void {
    // Don't await - let it run in background
    this.assessResponse(context).catch(error => {
      console.error("[Logic] Async assessment failed:", error);
    });
  }
}
