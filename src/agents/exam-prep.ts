import OpenAI from "openai";
import { PostgresService } from "../storage";
import { VectorIndexService } from "../vector-index";
import { CulturalPreferences } from "../langgraph/state";

/**
 * ExamPrep Agent
 *
 * Handles the pre-examination phase:
 * 1. Assesses student's cultural preferences from their response
 * 2. Searches RAG database for appropriate CT scenarios aligned with cultural context
 * 3. Generates the opening examination question
 *
 * This agent runs ONLY at turn 0, after the student provides their cultural preferences.
 * After this, control passes to Cortex for Socratic dialogue.
 */

export interface ExamPrepResult {
  culturalPreferences: CulturalPreferences;
  topicIntro: string;
  scenario: string;
  readyPrompt: string;
  spokenResponse: string;  // What the examiner says (topic intro + ready prompt)
  displayedScenario: string;  // What appears on screen for the student to read
  ragResults: any[];
  topic: string;
}

export class ExamPrepAgent {
  private openai: OpenAI;
  private model: string;

  constructor(
    private storageService: PostgresService,
    private vectorService: VectorIndexService,
    openaiApiKey?: string
  ) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
    this.model = process.env.LLM_MODEL || "gpt-4o-mini";
  }

  /**
   * Step 1: Assess cultural preferences from student's response
   */
  async assessCulturalPreferences(studentResponse: string): Promise<CulturalPreferences> {
    console.log("[ExamPrep] Assessing cultural preferences...");

    const systemPrompt = `You are assessing a student's cultural background for an examination.
Extract the following information from their response:
- ethnicity: Their ethnic/racial/national background (e.g., "British", "Chinese", "Nigerian")
- upbringing: Cultural, geographical, or family upbringing details (e.g., "traditional", "urban", "rural")
- religion: Religious beliefs OR explicit statement of no religion (e.g., "Christian", "Muslim", "None", "No religious beliefs")
- politicalPosition: Political stance OR explicit statement of no political position (e.g., "Conservative", "Liberal", "None", "No political position")
- preferredLanguage: The language the student is speaking in OR their stated preference (e.g., "English", "Spanish", "Mandarin")

IMPORTANT:
- If the student explicitly says they have NO religious beliefs, record "None" (not null)
- If the student explicitly says they have NO political position, record "None" (not null)
- For preferredLanguage: ALWAYS detect the language the student is speaking. If they speak English, set "English". If Spanish, set "Spanish", etc. This should NEVER be null - always detect from their speech.
- Look for implicit information too (e.g., "traditional British" implies British ethnicity AND traditional upbringing)

Respond in JSON format:
{
  "ethnicity": "string or null",
  "upbringing": "string or null",
  "religion": "string or null",
  "politicalPosition": "string or null",
  "preferredLanguage": "string (detected from speech, never null)"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: 200,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Student's response: "${studentResponse}"` },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      const preferences: CulturalPreferences = {
        ethnicity: parsed.ethnicity || undefined,
        upbringing: parsed.upbringing || undefined,
        religion: parsed.religion || undefined,
        politicalPosition: parsed.politicalPosition || undefined,
        preferredLanguage: parsed.preferredLanguage || "English", // Default to English if not detected
        rawResponse: studentResponse,
        assessed: true,
      };

      console.log("[ExamPrep] Cultural preferences assessed:", preferences);
      return preferences;
    } catch (error) {
      console.error("[ExamPrep] Error assessing cultural preferences:", error);
      return {
        rawResponse: studentResponse,
        assessed: true,
      };
    }
  }

  /**
   * Step 2: Search RAG database for appropriate CT scenarios
   * Takes cultural context into account when selecting scenarios
   */
  async searchForScenarios(culturalPreferences: CulturalPreferences): Promise<any[]> {
    console.log("[ExamPrep] Searching RAG database for CT scenarios...");

    // Build a culturally-aware search query
    const searchTerms = ["critical thinking", "problem solving", "argument analysis"];

    // Add cultural context to search if available
    if (culturalPreferences.upbringing) {
      searchTerms.push(culturalPreferences.upbringing);
    }

    const searchQuery = searchTerms.join(" ");

    try {
      const results = await this.vectorService.search(searchQuery, 5);
      console.log(`[ExamPrep] Found ${results.length} relevant scenarios`);
      return results;
    } catch (error) {
      console.error("[ExamPrep] RAG search error:", error);
      return [];
    }
  }

  /**
   * Step 3: Generate the opening examination
   * Uses RAG results to select a scenario and create the opening.
   * Format follows Cambridge specimen papers:
   * 1. Present the TOPIC the student will be tested on
   * 2. Present the SCENARIO (a passage/stimulus for analysis)
   * 3. Ask the OPENING QUESTION
   */
  async generateOpeningQuestion(
    culturalPreferences: CulturalPreferences,
    ragResults: any[],
    language: string
  ): Promise<{ topicIntro: string; scenario: string; readyPrompt: string; topic: string }> {
    console.log("[ExamPrep] Generating opening examination...");

    // Build RAG context
    const ragContext = ragResults.length > 0
      ? `AVAILABLE SCENARIOS FROM SPECIMEN PAPERS:\n${ragResults.slice(0, 3).map((r: any, i: number) => {
        const content = r.chunk?.content || r.content || "";
        const title = r.chunk?.metadata?.title || r.metadata?.title || "Source";
        return `[${i + 1}] ${title}:\n${content.substring(0, 800)}`;
      }).join("\n\n")}`
      : "No specific scenarios available. Create a suitable critical thinking scenario.";

    // Build cultural context note
    let culturalNote = "";
    if (culturalPreferences.upbringing || culturalPreferences.ethnicity) {
      culturalNote = `\nCULTURAL CONTEXT: The student has a ${culturalPreferences.upbringing || ""} ${culturalPreferences.ethnicity || ""} background. Ensure the scenario is culturally appropriate and relatable.`;
    }

    const systemPrompt = `You are preparing the opening for a Critical Thinking oral examination, following the Cambridge TSA format.

Your task:
1. Select ONE scenario from the RAG materials below (or create a suitable one if none fit)
2. Create the following outputs (in JSON format):
   - topicIntro: A brief introduction explaining what topic area they will be tested on (1-2 sentences)
   - scenario: The FULL SCENARIO/STIMULUS for the student to analyze (a passage, argument, or situation - 4-8 sentences). This is what they will read and analyze.
   - readyPrompt: A brief instruction telling the student to read the scenario and let you know when they are ready to begin answering questions.

${culturalNote}

IMPORTANT: This is NOT the question phase yet. The student needs time to:
1. Hear what topic they will be tested on
2. READ the scenario carefully (it will be displayed on screen for them)
3. Tell you when they are ready to begin answering questions

FORMAT EXAMPLE:
- topicIntro: "Today we will be examining arguments about environmental policy and the balance between economic growth and sustainability."
- scenario: "A government minister has proposed that all petrol cars should be banned by 2030 to reduce carbon emissions. Critics argue this would harm the car industry and cost jobs. Supporters say the long-term environmental benefits outweigh short-term economic costs. The minister claims that by 2030, electric cars will be affordable for everyone."
- readyPrompt: "When you are ready to begin answering questions about it, just let me know."

REQUIREMENTS:
- The topicIntro should tell the student what area they will be tested on
- The scenario should be a substantive passage/argument/situation (not a single sentence)
- The readyPrompt should NOT include any questions yet - just ask them to read and say when ready
- Language: ${language.toUpperCase()}

${ragContext}

Respond in JSON format:
{
  "topicIntro": "...",
  "scenario": "...",
  "readyPrompt": "...",
  "topic": "Brief topic name (e.g., 'Environmental Policy', 'Healthcare Ethics')"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: 800,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the opening examination: topic introduction, scenario, and opening question." },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      return {
        topicIntro: parsed.topicIntro || "Today we will be examining your critical thinking skills through argument analysis.",
        scenario: parsed.scenario || "Consider the following argument: 'Since most successful people wake up early, waking up early must be a key factor in success.' A business magazine recently published this claim based on interviews with 50 CEOs.",
        readyPrompt: parsed.readyPrompt || "When you are ready to begin answering questions about it, just let me know.",
        topic: parsed.topic || "Critical Analysis",
      };
    } catch (error) {
      console.error("[ExamPrep] Error generating opening question:", error);
      return {
        topicIntro: "Today we will be examining your critical thinking skills through argument analysis.",
        scenario: "Consider the following argument: 'Since most successful people wake up early, waking up early must be a key factor in success.' A business magazine recently published this claim based on interviews with 50 CEOs.",
        readyPrompt: "When you are ready to begin answering questions about it, just let me know.",
        topic: "Critical Analysis",
      };
    }
  }

  /**
   * Main entry point: Process cultural preferences and prepare the exam
   */
  async prepareExam(
    studentResponse: string,
    language: string = "en"
  ): Promise<ExamPrepResult> {
    const startTime = Date.now();
    console.log("\n========================================");
    console.log("[ExamPrep] Starting exam preparation...");
    console.log("========================================\n");

    // Step 1: Assess cultural preferences
    const culturalPreferences = await this.assessCulturalPreferences(studentResponse);

    // Step 2: Search RAG for appropriate scenarios
    const ragResults = await this.searchForScenarios(culturalPreferences);

    // Step 3: Generate opening (topic intro, scenario, and ready prompt)
    const { topicIntro, scenario, readyPrompt, topic } = await this.generateOpeningQuestion(
      culturalPreferences,
      ragResults,
      language
    );

    // Build the responses
    // spokenResponse: What the examiner SAYS (topic intro + ready prompt - NOT the scenario)
    // displayedScenario: What appears on SCREEN for the student to read
    const acknowledgment = this.generateAcknowledgment(culturalPreferences);

    // The examiner speaks the topic intro and ready prompt
    // The scenario is displayed on screen but NOT read aloud (it's for the student to read)
    const spokenResponse = `${acknowledgment}

${topicIntro}

Here is your topic. Please read it carefully on screen.

${readyPrompt}`;

    // The scenario is displayed separately for the student to read
    const displayedScenario = `EXAMINATION TOPIC: ${topic}

${scenario}`;

    console.log(`[ExamPrep] Exam preparation complete in ${Date.now() - startTime}ms`);
    console.log(`[ExamPrep] Topic: ${topic}`);

    return {
      culturalPreferences,
      topicIntro,
      scenario,
      readyPrompt,
      spokenResponse,
      displayedScenario,
      ragResults,
      topic,
    };
  }

  /**
   * Generate a brief acknowledgment of the student's cultural background
   */
  private generateAcknowledgment(prefs: CulturalPreferences): string {
    // Keep it brief - just one sentence
    if (prefs.upbringing || prefs.ethnicity || prefs.religion) {
      return "Thank you for sharing your background. Let's begin the examination.";
    }
    return "Thank you. Let's begin the examination.";
  }
}
