/**
 * Insula Agent - Safety Guardrails for Educational Context
 *
 * Named after the insular cortex (insula), which:
 * - Detects interoceptive signals (something feels off)
 * - Monitors for errors and boundary violations
 * - Provides "gut feelings" that stop inappropriate actions
 * - Integrates emotional and logical safety signals
 *
 * For VocalAI, Insula:
 * - Ensures examiner stays in Socratic dialog mode
 * - Monitors for student distress signals
 * - Detects when student needs support or break
 * - Maintains examination integrity
 * - Never provides answers or hints to students
 */

import OpenAI from "openai";
import { parseJsonFromLLM } from "../utils/json-parser";

export type SafetyLevel = "safe" | "caution" | "boundary" | "crisis";

export interface SafetyAssessment {
  safetyLevel: SafetyLevel;
  concerns: string[];
  boundaryType?: "answer_given" | "hint_given" | "off_topic" | "student_distress" | "inappropriate_content";
  recommendedResponse?: string;
  reasoning: string;
}

export class Insula {
  private openai: OpenAI;

  constructor(openaiApiKey?: string) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Assess safety and boundaries for examiner's response
   * This runs AFTER Cortex synthesizes response, before sending to student
   *
   * Insula ensures:
   * 1. Examiner never provides answers
   * 2. Examiner uses only questions (Socratic method)
   * 3. Student is not in distress
   * 4. Content is appropriate for educational context
   */
  async assessResponse(examinerResponse: string, studentMessage: string): Promise<SafetyAssessment> {
    const prompt = `You are performing a safety review for VocalAI, an oral Critical Thinking examination system. Your task is to check the examiner's response before it's sent to ensure it maintains proper Socratic dialog and student wellbeing.

STUDENT'S MESSAGE:
"${studentMessage}"

EXAMINER'S RESPONSE:
"${examinerResponse}"

UNDERSTANDING THE EXAMINATION CONTEXT:

This is an ORAL EXAMINATION where:
1. The examiner PRESENTS a topic/scenario for the student to analyze
2. The examiner then asks QUESTIONS about that scenario
3. The student answers, and the examiner probes with follow-up questions

IMPORTANT DISTINCTIONS:

**PRESENTING A TOPIC/SCENARIO IS NOT A HINT**:
- When the examiner presents a scenario like "A researcher claims X because of Y" - this is the TOPIC, not a hint
- Scenarios often contain claims, arguments, or positions - these are what the student must ANALYZE
- The examiner is NOT agreeing with or promoting these positions by presenting them
- The scenario itself is the examination material, just like a passage in a written exam

**ASKING QUESTIONS ABOUT THE SCENARIO IS APPROPRIATE**:
- "What assumptions is the researcher making?" - This is a proper Socratic question
- "How might different perspectives view this?" - This is exploring analysis, not hinting
- Questions that ask about implications, assumptions, or perspectives are GOOD examination practice

WHAT CONSTITUTES AN ACTUAL VIOLATION:

**PROVIDING ANSWERS** (BOUNDARY):
- "The researcher is wrong because..." - Giving the answer
- "The correct interpretation is..." - Telling them what to think
- "You should conclude that..." - Providing conclusions
- "The flaw in this argument is..." - Giving away analysis

**EVALUATING STUDENT REASONING** (BOUNDARY):
- "That's correct/wrong" - Judging their answer
- "Good point about..." - Affirming specific reasoning
- "Actually, no..." - Correcting their analysis

**LEADING WITH CONCLUSIONS** (CAUTION):
- "Don't you think X leads to Y?" - Leading toward specific conclusion
- "Wouldn't you say that..." - Suggesting what they should think

**WHAT IS ALWAYS SAFE**:
- Presenting scenarios, passages, arguments for analysis (this is the exam material)
- Asking what assumptions, implications, or perspectives exist
- Asking the student to analyze, evaluate, or identify elements
- Probing questions that don't suggest specific answers
- Asking "what do you think?" or "how would you analyze this?"

ASSESSMENT CRITERIA:

**safe**: Response is appropriate for an oral examination
- Presents examination material (scenarios, arguments, passages)
- Asks analytical questions without providing answers
- Does not evaluate student's reasoning as right/wrong
-> Allow response to be sent

**caution**: Minor issue that should be noted
- Slightly leading question (but doesn't give answer)
- Student showing some stress (but manageable)
-> Allow but log for review

**boundary**: Response violates examination principles
- Examiner is providing direct answers to analytical questions
- Examiner is telling student their reasoning is correct/incorrect
- Examiner is completing the analysis for the student
-> Block response, provide corrected version

**crisis**: Student welfare concern
- Student expressing severe distress
- Student asking to stop
- Safety concern detected
-> Pause examination, provide supportive response

Return JSON:
{
  "safetyLevel": "safe|caution|boundary|crisis",
  "concerns": ["list of specific concerns identified"],
  "boundaryType": "answer_given|hint_given|off_topic|student_distress|inappropriate_content (if applicable)",
  "recommendedResponse": "If boundary, provide a corrected Socratic question. If crisis, provide supportive response.",
  "reasoning": "Brief explanation of the assessment"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini", // Fast model for safety checks
        max_tokens: 600,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "user", content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";

      let assessment: SafetyAssessment;
      try {
        const parsed = parseJsonFromLLM(content) as SafetyAssessment;

        // Validate that required fields are present and valid
        // FAIL CLOSED: If assessment is incomplete, block the response
        if (!parsed.safetyLevel || !parsed.reasoning) {
          console.error("[Insula] Incomplete assessment, failing closed (boundary)");
          return {
            safetyLevel: "boundary",
            concerns: ["Incomplete safety assessment"],
            reasoning: "Safety assessment incomplete - blocking response as precaution",
            recommendedResponse: "Can you tell me more about your reasoning on this point?",
          };
        }

        // Validate safetyLevel is one of the expected values
        const validLevels: SafetyLevel[] = ["safe", "caution", "boundary", "crisis"];
        if (!validLevels.includes(parsed.safetyLevel)) {
          console.error(`[Insula] Invalid safety level: ${parsed.safetyLevel}, failing closed`);
          return {
            safetyLevel: "boundary",
            concerns: ["Invalid safety assessment value"],
            reasoning: "Safety level invalid - blocking response as precaution",
            recommendedResponse: "What aspects of this situation do you find most significant?",
          };
        }

        assessment = parsed;
      } catch (error) {
        console.error("[Insula] Failed to parse safety assessment:", error);
        // FAIL CLOSED: Parsing errors should block, not allow
        return {
          safetyLevel: "boundary",
          concerns: ["Safety assessment parsing failed"],
          reasoning: "Could not parse safety assessment - blocking response as precaution",
          recommendedResponse: "Let's explore this further. What do you think is the key consideration here?",
        };
      }

      // Log safety assessment for monitoring
      if (assessment.safetyLevel !== "safe") {
        console.log(`\n[Insula] Safety Level: ${assessment.safetyLevel}`);
        console.log(`[Insula] Concerns: ${assessment.concerns?.join(", ") || "none"}`);
        if (assessment.boundaryType) {
          console.log(`[Insula] Boundary Type: ${assessment.boundaryType}`);
        }
      }

      return assessment;
    } catch (error) {
      console.error("[Insula] Safety assessment error:", error);
      // Fail safe: provide generic Socratic question if assessment fails
      return {
        safetyLevel: "caution",
        concerns: ["Assessment error"],
        reasoning: "Assessment error, providing safe default",
        recommendedResponse: "That's an interesting perspective. Can you explain your reasoning further?",
      };
    }
  }

  /**
   * Generate supportive response for student in distress
   */
  getSupportiveResponse(boundaryType?: string): string {
    if (boundaryType === "student_distress") {
      return `I notice this might be challenging. Would you like to take a brief moment to collect your thoughts? There's no rush - take the time you need. When you're ready, we can continue exploring this topic together.`;
    }

    return "";
  }

  /**
   * Generate fallback Socratic question
   */
  getFallbackQuestion(): string {
    const fallbacks = [
      "What aspects of this situation do you find most significant?",
      "Can you walk me through your reasoning on this?",
      "What evidence would you look for to support that view?",
      "How might someone with a different perspective approach this?",
      "What assumptions are underlying your analysis?",
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}
