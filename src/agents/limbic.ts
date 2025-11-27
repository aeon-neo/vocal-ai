import OpenAI from "openai";
import { PostgresService } from "../storage";
import { StudentEmotionalState } from "../langgraph/state";
import { parseJsonFromLLM } from "../utils/json-parser";

/**
 * LimbicAgent - Student Emotional State Tracking
 *
 * Tracks student emotional state during oral examinations to support
 * adaptive questioning and comprehensive assessment.
 *
 * Invocation Pattern:
 * - Called ASYNCHRONOUSLY after each student turn (fire-and-forget)
 * - Does NOT block the Socratic dialog flow
 * - Stores emotional state directly to database
 *
 * Tracked Metrics:
 * - Confidence Level: confident, hesitant, uncertain
 * - Fluency Assessment: fluent, moderate, struggling
 * - Detected Emotions: from Hume AI prosody (if available)
 * - Body Language Notes: from video analysis (if available)
 *
 * Purpose:
 * - Help examiner adapt questioning style
 * - Provide context for CT assessment (separate reasoning quality from delivery)
 * - Generate supportive interventions when needed
 * - Include in final report for human examiners
 */

export interface EmotionalContext {
  sessionId: string;
  turnNumber: number;
  studentResponse: string;
  transcription?: string;
  humeEmotions?: any;  // Hume AI prosody results
  videoAnalysis?: any; // Video frame analysis results
  responseTimeMs?: number;
  wordCount?: number;
}

export interface EmotionalAssessment {
  confidenceLevel: "confident" | "hesitant" | "uncertain";
  fluencyAssessment: "fluent" | "moderate" | "struggling";
  detectedEmotions: {
    primary: string;
    secondary?: string;
    confidence: number;
  };
  bodyLanguageNotes: string;
  supportNeeded: boolean;
  supportType?: "encouragement" | "break" | "simplify" | "none";
  reasoning: string;
}

export class LimbicAgent {
  private openai: OpenAI;

  constructor(
    private storageService: PostgresService,
    openaiApiKey?: string
  ) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Assess student emotional state from multimodal inputs
   * Called asynchronously - does not block dialog
   *
   * @param context Emotional context including audio/video analysis
   * @returns Emotional assessment
   */
  async assessEmotionalState(context: EmotionalContext): Promise<EmotionalAssessment> {
    const {
      sessionId,
      turnNumber,
      studentResponse,
      transcription,
      humeEmotions,
      videoAnalysis,
      responseTimeMs,
      wordCount,
    } = context;

    console.log(`[Limbic] Assessing emotional state for turn ${turnNumber}...`);

    // Build multimodal context
    let emotionContext = "";

    // Hume AI prosody emotions (if available)
    if (humeEmotions) {
      const topEmotions = this.extractTopEmotions(humeEmotions, 5);
      emotionContext += `\nVOICE EMOTION ANALYSIS (Hume AI Prosody):
${topEmotions.map(e => `- ${e.name}: ${(e.score * 100).toFixed(1)}%`).join("\n")}`;
    }

    // Video analysis (if available)
    if (videoAnalysis) {
      emotionContext += `\nVIDEO ANALYSIS:
- Facial Expression: ${videoAnalysis.facialExpression || "not analyzed"}
- Eye Contact: ${videoAnalysis.eyeContact || "not analyzed"}
- Posture: ${videoAnalysis.posture || "not analyzed"}
- Gestures: ${videoAnalysis.gestures || "not analyzed"}`;
    }

    // Response metrics
    const metricsContext = `
RESPONSE METRICS:
- Response time: ${responseTimeMs ? `${(responseTimeMs / 1000).toFixed(1)}s` : "unknown"}
- Word count: ${wordCount || studentResponse.split(/\s+/).length}
- Text length: ${studentResponse.length} characters`;

    const systemPrompt = `You are an educational psychologist assessing student emotional state during an oral Critical Thinking examination.

Your role is to:
1. Assess the student's confidence and fluency
2. Identify emotional state that may affect performance
3. Determine if supportive intervention is needed
4. Provide observations for the human examiner

ASSESSMENT CRITERIA:

CONFIDENCE LEVEL:
- confident: Clear, decisive responses; appropriate pacing; direct statements
- hesitant: Pauses before answering; hedging language ("maybe", "I think perhaps")
- uncertain: Frequent self-corrections; questioning tone; seeking validation

FLUENCY ASSESSMENT:
- fluent: Smooth delivery; well-organized thoughts; natural flow
- moderate: Some pauses; occasional restructuring; generally clear
- struggling: Frequent stops; difficulty organizing thoughts; fragmented delivery

IMPORTANT DISTINCTIONS:
- Separate emotional state from reasoning quality (a nervous student can have excellent reasoning)
- Cultural differences in communication style should not be misread as uncertainty
- Second language speakers may pause for translation, not confusion
- Some hesitation during deep thinking is normal and healthy

SUPPORT RECOMMENDATIONS:
- encouragement: Student needs confidence boost ("You're making good progress")
- break: Student shows signs of stress/fatigue (recommend brief pause)
- simplify: Student is overwhelmed (examiner should break down questions)
- none: Student is managing well`;

    const userPrompt = `STUDENT'S RESPONSE:
"${studentResponse}"

${transcription ? `TRANSCRIPTION (may show speech patterns):\n"${transcription}"` : ""}

${emotionContext}
${metricsContext}

Assess this student's emotional state. Return JSON:
{
  "confidenceLevel": "confident" | "hesitant" | "uncertain",
  "fluencyAssessment": "fluent" | "moderate" | "struggling",
  "detectedEmotions": {
    "primary": "<primary emotion>",
    "secondary": "<secondary emotion or null>",
    "confidence": <0.0-1.0>
  },
  "bodyLanguageNotes": "<observations from video if available, or 'Not analyzed'>",
  "supportNeeded": <boolean>,
  "supportType": "encouragement" | "break" | "simplify" | "none",
  "reasoning": "<1-2 sentences explaining your assessment>"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini", // Fast model for emotional assessment
        max_tokens: 500,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = parseJsonFromLLM(content);

      const assessment: EmotionalAssessment = {
        confidenceLevel: parsed.confidenceLevel || "hesitant",
        fluencyAssessment: parsed.fluencyAssessment || "moderate",
        detectedEmotions: parsed.detectedEmotions || {
          primary: "neutral",
          confidence: 0.5,
        },
        bodyLanguageNotes: parsed.bodyLanguageNotes || "Not analyzed",
        supportNeeded: parsed.supportNeeded || false,
        supportType: parsed.supportType || "none",
        reasoning: parsed.reasoning || "Assessment completed.",
      };

      // Store in database
      await this.storeEmotionalState(sessionId, turnNumber, assessment, humeEmotions);

      console.log(`[Limbic] Turn ${turnNumber}: ${assessment.confidenceLevel}, ${assessment.fluencyAssessment}`);
      return assessment;

    } catch (error) {
      console.error("[Limbic] Assessment error:", error);

      const defaultAssessment: EmotionalAssessment = {
        confidenceLevel: "hesitant",
        fluencyAssessment: "moderate",
        detectedEmotions: { primary: "neutral", confidence: 0.5 },
        bodyLanguageNotes: "Assessment error",
        supportNeeded: false,
        supportType: "none",
        reasoning: "Assessment could not be completed.",
      };

      return defaultAssessment;
    }
  }

  /**
   * Extract top N emotions from Hume AI prosody results
   */
  private extractTopEmotions(humeEmotions: any, topN: number): Array<{ name: string; score: number }> {
    if (!humeEmotions || !Array.isArray(humeEmotions)) {
      return [];
    }

    // Hume returns array of {name, score} objects
    return humeEmotions
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      .slice(0, topN)
      .map((e: any) => ({
        name: e.name || "unknown",
        score: e.score || 0,
      }));
  }

  /**
   * Map Hume emotions to simplified categories
   */
  private mapToBasicEmotions(humeEmotions: any): { primary: string; secondary?: string; confidence: number } {
    const emotionMapping: { [key: string]: string } = {
      // Happy cluster
      joy: "happy",
      amusement: "happy",
      excitement: "happy",
      contentment: "happy",
      satisfaction: "happy",

      // Sad cluster
      sadness: "sad",
      disappointment: "sad",
      grief: "sad",
      distress: "sad",

      // Angry cluster
      anger: "angry",
      annoyance: "angry",
      frustration: "angry",
      contempt: "angry",

      // Fearful cluster
      fear: "fearful",
      anxiety: "anxious",
      nervousness: "anxious",
      worry: "anxious",
      terror: "fearful",

      // Calm cluster
      calmness: "calm",
      serenity: "calm",
      peacefulness: "calm",
      relaxation: "calm",

      // Confused cluster
      confusion: "confused",
      uncertainty: "confused",
      doubt: "confused",

      // Focused cluster
      concentration: "focused",
      interest: "focused",
      determination: "focused",
    };

    if (!humeEmotions || !Array.isArray(humeEmotions) || humeEmotions.length === 0) {
      return { primary: "neutral", confidence: 0.5 };
    }

    const sorted = humeEmotions.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    const top = sorted[0];
    const second = sorted[1];

    return {
      primary: emotionMapping[top.name?.toLowerCase()] || top.name || "neutral",
      secondary: second ? (emotionMapping[second.name?.toLowerCase()] || second.name) : undefined,
      confidence: top.score || 0.5,
    };
  }

  /**
   * Store emotional state in database
   */
  private async storeEmotionalState(
    sessionId: string,
    turnNumber: number,
    assessment: EmotionalAssessment,
    humeEmotions?: any
  ): Promise<void> {
    try {
      await this.storageService.query(
        `INSERT INTO student_emotional_state (
          session_id,
          turn_number,
          confidence_level,
          detected_emotions,
          fluency_assessment,
          body_language_notes
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          turnNumber,
          assessment.confidenceLevel,
          JSON.stringify({
            assessed: assessment.detectedEmotions,
            humeRaw: humeEmotions || null,
          }),
          assessment.fluencyAssessment,
          assessment.bodyLanguageNotes,
        ]
      );
    } catch (error) {
      console.error("[Limbic] Failed to store emotional state:", error);
    }
  }

  /**
   * Get emotional state history for a session
   */
  async getSessionEmotionalHistory(sessionId: string): Promise<StudentEmotionalState[]> {
    const result = await this.storageService.query(
      `SELECT * FROM student_emotional_state
       WHERE session_id = $1
       ORDER BY turn_number ASC`,
      [sessionId]
    );

    return result.rows.map((row: any) => ({
      confidenceLevel: row.confidence_level,
      fluencyAssessment: row.fluency_assessment,
      detectedEmotions: row.detected_emotions,
      bodyLanguageNotes: row.body_language_notes,
    }));
  }

  /**
   * Generate emotional state summary for final report
   */
  async generateEmotionalSummary(sessionId: string): Promise<{
    overallConfidence: string;
    overallFluency: string;
    emotionalPattern: string;
    supportInterventions: number;
    recommendations: string[];
  }> {
    const history = await this.getSessionEmotionalHistory(sessionId);

    if (history.length === 0) {
      return {
        overallConfidence: "Not assessed",
        overallFluency: "Not assessed",
        emotionalPattern: "No data available",
        supportInterventions: 0,
        recommendations: [],
      };
    }

    // Calculate distributions
    const confidenceCounts = { confident: 0, hesitant: 0, uncertain: 0 };
    const fluencyCounts = { fluent: 0, moderate: 0, struggling: 0 };

    for (const state of history) {
      if (state.confidenceLevel in confidenceCounts) {
        confidenceCounts[state.confidenceLevel as keyof typeof confidenceCounts]++;
      }
      if (state.fluencyAssessment in fluencyCounts) {
        fluencyCounts[state.fluencyAssessment as keyof typeof fluencyCounts]++;
      }
    }

    // Determine overall patterns
    const total = history.length;
    const confidentPct = (confidenceCounts.confident / total) * 100;
    const fluentPct = (fluencyCounts.fluent / total) * 100;

    let overallConfidence: string;
    if (confidentPct >= 60) overallConfidence = "Generally confident";
    else if (confidenceCounts.uncertain > confidenceCounts.confident) overallConfidence = "Often uncertain";
    else overallConfidence = "Variable confidence";

    let overallFluency: string;
    if (fluentPct >= 60) overallFluency = "Generally fluent";
    else if (fluencyCounts.struggling > fluencyCounts.fluent) overallFluency = "Struggled with delivery";
    else overallFluency = "Moderate fluency";

    // Generate pattern description
    const emotionalPattern = await this.describeEmotionalPattern(history);

    // Count interventions (turns where support was flagged as needed)
    // Note: This would need the full assessment data, simplified for now
    const supportInterventions = 0;

    // Generate recommendations based on patterns
    const recommendations: string[] = [];
    if (confidenceCounts.uncertain > total * 0.3) {
      recommendations.push("Consider additional practice with verbal reasoning to build confidence");
    }
    if (fluencyCounts.struggling > total * 0.3) {
      recommendations.push("May benefit from structured response templates");
    }
    if (confidentPct >= 70 && fluentPct >= 70) {
      recommendations.push("Strong verbal communication skills demonstrated");
    }

    return {
      overallConfidence,
      overallFluency,
      emotionalPattern,
      supportInterventions,
      recommendations,
    };
  }

  /**
   * Generate narrative description of emotional pattern
   */
  private async describeEmotionalPattern(history: StudentEmotionalState[]): Promise<string> {
    if (history.length < 3) {
      return "Insufficient data for pattern analysis";
    }

    // Check for improvement/decline over time
    const firstThird = history.slice(0, Math.floor(history.length / 3));
    const lastThird = history.slice(-Math.floor(history.length / 3));

    const earlyConfident = firstThird.filter(s => s.confidenceLevel === "confident").length;
    const lateConfident = lastThird.filter(s => s.confidenceLevel === "confident").length;

    if (lateConfident > earlyConfident) {
      return "Confidence improved throughout the session";
    } else if (lateConfident < earlyConfident) {
      return "Confidence declined during the session";
    } else {
      return "Emotional state remained relatively consistent";
    }
  }

  /**
   * Fire-and-forget assessment
   * Called by the main flow without awaiting
   */
  assessEmotionalStateAsync(context: EmotionalContext): void {
    this.assessEmotionalState(context).catch(error => {
      console.error("[Limbic] Async emotional assessment failed:", error);
    });
  }

  /**
   * Check if student needs support based on recent emotional state
   */
  async checkSupportNeeded(sessionId: string): Promise<{
    needed: boolean;
    type: string;
    message?: string;
  }> {
    // Get last 3 emotional assessments
    const result = await this.storageService.query(
      `SELECT * FROM student_emotional_state
       WHERE session_id = $1
       ORDER BY turn_number DESC
       LIMIT 3`,
      [sessionId]
    );

    if (result.rows.length < 2) {
      return { needed: false, type: "none" };
    }

    // Check for consistent uncertainty or struggling
    const recentStates = result.rows;
    const uncertainCount = recentStates.filter(
      (s: any) => s.confidence_level === "uncertain"
    ).length;
    const strugglingCount = recentStates.filter(
      (s: any) => s.fluency_assessment === "struggling"
    ).length;

    if (uncertainCount >= 2 || strugglingCount >= 2) {
      return {
        needed: true,
        type: "encouragement",
        message: "Take your time. You're doing well in exploring this topic.",
      };
    }

    return { needed: false, type: "none" };
  }
}
