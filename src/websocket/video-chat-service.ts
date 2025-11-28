/**
 * Video Chat Service
 *
 * Integrates video chat WebSocket with Niimi's conversation system.
 * Handles audio transcription and graph invocation for real-time chat.
 */

import { AudioExtractor } from "../utils/audio-extractor";
import OpenAI from "openai";
import { VocalAIGraph } from "../langgraph/graph";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  EmotionAnalysis,
  MoodAnalysis,
  SentimentAnalysis,
  BasicEmotion,
  MoodState,
  Sentiment,
} from "./behavioral-types";
import { analyzeAudioEmotions } from "../utils/audio-emotion-hume";

export type WhisperProvider = "openai" | "local";

export interface VideoChatMessage {
  sessionId: string;
  audio: string; // Base64 encoded audio
  timestamp: number;
}

export interface VideoChatResponse {
  success: boolean;
  transcript?: string;
  response?: string;
  error?: string;
  timestamp: number;
  isFinalAssessment?: boolean;
}

export interface TranscriptionResult {
  success: boolean;
  transcript?: string;
  error?: string;
  timestamp: number;
}

export interface AudioEmotionAnalysis {
  emotion: EmotionAnalysis;
  mood: MoodAnalysis;
  sentiment: SentimentAnalysis;
  cues: string[];
}

export interface AudioEmotionResult {
  success: boolean;
  analysis?: AudioEmotionAnalysis;
  error?: string;
  timestamp: number;
}

const execFileAsync = promisify(execFile);

export class VideoChatService {
  private audioExtractor: AudioExtractor;
  private openai: OpenAI;
  private vocalAIGraph: VocalAIGraph;
  private whisperProvider: WhisperProvider;

  constructor(
    vocalAIGraph: VocalAIGraph,
    whisperProvider: WhisperProvider = "openai",
    openaiApiKey?: string
  ) {
    this.vocalAIGraph = vocalAIGraph;
    this.whisperProvider = whisperProvider;
    this.audioExtractor = new AudioExtractor();
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  async startExamSession(studentName?: string, language?: string) {
    return this.vocalAIGraph.startExamSession(studentName, language);
  }

  /**
   * Transcribe audio only (fast, for immediate UI feedback)
   * Uses OpenAI Whisper API if available, otherwise local Whisper
   */
  async transcribeAudioQuick(audioBase64: string): Promise<string> {
    let tempAudioPath: string | null = null;

    try {
      // Save audio to temporary file
      tempAudioPath = await this.saveAudioToTempFile(audioBase64);

      // Check for silence before transcription (prevents Whisper hallucinations)
      const isSilent = await this.detectSilence(tempAudioPath);
      if (isSilent) {
        console.log("[VideoChatService] Audio is silent or too quiet, skipping transcription");
        throw new Error("Audio is silent or too quiet. Please speak louder.");
      }

      let transcript: string;

      if (this.whisperProvider === "openai" && this.openai) {
        console.log("[VideoChatService] Transcribing with OpenAI Whisper API...");
        const transcription = await this.openai.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioPath),
          model: "whisper-1",
          prompt: "The student is taking a Critical Thinking oral examination. Common topics: arguments, reasoning, evidence, assumptions, conclusions, logic, fallacies.",
        });
        transcript = transcription.text.trim();
      } else {
        console.log("[VideoChatService] Transcribing with local Whisper...");
        const transcriptionResult = await this.audioExtractor.transcribeAudio(
          tempAudioPath,
          { returnTimestamps: false }
        );

        if (!transcriptionResult.success || !transcriptionResult.transcript) {
          throw new Error(transcriptionResult.error || "Transcription failed");
        }
        transcript = transcriptionResult.transcript.trim();
      }

      console.log(`[VideoChatService] Transcription complete: "${transcript}"`);
      return transcript;
    } finally {
      // Clean up temporary file
      if (tempAudioPath) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (err) {
          console.warn(
            `[VideoChatService] Failed to delete temp file: ${tempAudioPath}`,
            err
          );
        }
      }
    }
  }

  /**
   * Analyze emotions from audio using Hume AI
   * Analyzes actual voice characteristics using Hume's trained models
   */
  async analyzeAudioEmotionsFromVoice(audioBase64: string): Promise<AudioEmotionAnalysis> {
    let tempAudioPath: string | null = null;

    try {
      // Save audio to temporary file for Hume API
      tempAudioPath = await this.saveAudioToTempFile(audioBase64);

      // Analyze with Hume AI
      console.log("[VideoChatService] Analyzing audio emotions with Hume AI...");
      const emotionResult = await analyzeAudioEmotions(tempAudioPath);

      // Map Hume results to our format
      return this.mapHumeToAudioEmotions(emotionResult);
    } finally {
      // Clean up temporary file
      if (tempAudioPath) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (err) {
          console.warn(
            `[VideoChatService] Failed to delete temp file: ${tempAudioPath}`,
            err
          );
        }
      }
    }
  }

  /**
   * Map Hume AI emotion results to AudioEmotionAnalysis format
   */
  private mapHumeToAudioEmotions(result: any): AudioEmotionAnalysis {
    // Map Hume emotions to our BasicEmotion types
    const emotionScores: Record<BasicEmotion, number> = {
      happy: result.all.happy || 0,
      sad: result.all.sad || 0,
      angry: result.all.angry || 0,
      fearful: result.all.fearful || 0,
      surprised: 0, // Not in Hume's basic mapping
      disgusted: 0, // Not in Hume's basic mapping
      neutral: result.all.neutral || 0,
    };

    // Infer moods from emotions
    const moodScores: Record<MoodState, number> = {
      anxious: (result.all.fearful || 0) * 0.8,
      relaxed: (result.all.calm || 0) * 0.9 + (result.all.neutral || 0) * 0.1,
      frustrated: (result.all.angry || 0) * 0.8,
      excited: (result.all.happy || 0) * 0.7,
      focused: (result.all.neutral || 0) * 0.6 + (result.all.calm || 0) * 0.4,
    };

    // Find primary mood
    const primaryMood = Object.entries(moodScores).reduce(
      (max, [mood, score]) =>
        score > max.score ? { mood: mood as MoodState, score } : max,
      { mood: "focused" as MoodState, score: 0 }
    );

    // Calculate sentiment from emotions
    const positiveScore = (result.all.happy || 0) + (result.all.calm || 0) * 0.5;
    const negativeScore =
      (result.all.sad || 0) + (result.all.angry || 0) + (result.all.fearful || 0);
    const sentimentScore = positiveScore - negativeScore;
    const sentimentPolarity: Sentiment =
      sentimentScore > 0.15 ? "positive" : sentimentScore < -0.15 ? "negative" : "neutral";

    return {
      emotion: {
        primary: result.primary as BasicEmotion,
        confidence: result.confidence,
        all: emotionScores,
      },
      mood: {
        primary: primaryMood.mood,
        confidence: primaryMood.score,
        all: moodScores,
      },
      sentiment: {
        polarity: sentimentPolarity,
        score: sentimentScore,
      },
      cues: [
        `Primary emotion: ${result.primary}`,
        `Confidence: ${(result.confidence * 100).toFixed(1)}%`,
        `Analyzed by Hume AI from voice prosody`,
      ],
    };
  }

  /**
   * Transcribe audio and analyze emotions using GPT-4o-audio-preview
   * DEPRECATED: GPT-4o only does transcription, not emotion analysis
   * Use transcribeAndAnalyzeLocal() instead
   */
  async transcribeAndAnalyzeWithGPT4o(
    message: VideoChatMessage
  ): Promise<{
    transcript: string;
    emotions: AudioEmotionAnalysis;
  }> {
    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const originalAudioPath = await this.saveAudioToTempFile(message.audio);
    let convertedAudioPath: string | null = null;

    try {
      console.log("[VideoChatService] Processing audio with GPT-4o-audio-preview...");

      // Convert to WAV before sending (GPT-4o only accepts wav/mp3)
      convertedAudioPath = await this.convertWebMToWav(originalAudioPath);
      const audioBuffer = await fs.promises.readFile(convertedAudioPath);
      const audioBase64 = audioBuffer.toString("base64");

      // Call GPT-4o-audio-preview for both transcription and emotion analysis
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-audio-preview",
        modalities: ["text", "audio"] as any,
        audio: {
          voice: "alloy",
          format: "wav",
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: audioBase64,
                  format: "wav"
                }
              },
              {
                type: "text",
                text: `Analyze this audio recording and provide:

1. Transcription of the spoken words
2. Emotional analysis based on voice characteristics (tone, pitch, prosody, speaking rate, volume):
   - 7 basic emotions (happy, sad, angry, fearful, surprised, disgusted, neutral) with confidence scores
   - 5 mood states (anxious, relaxed, frustrated, excited, focused) with confidence scores
   - Sentiment polarity (positive/negative/neutral) with score
   - Vocal cues observed (e.g., "trembling voice", "fast speech rate", "high pitch")

Respond in JSON format:
{
  "transcript": "word-for-word transcription",
  "emotion": {
    "primary": "emotion name",
    "confidence": 0.0-1.0,
    "scores": { "happy": 0.0-1.0, "sad": 0.0-1.0, ... }
  },
  "mood": {
    "primary": "mood name",
    "confidence": 0.0-1.0,
    "scores": { "anxious": 0.0-1.0, ... }
  },
  "sentiment": {
    "polarity": "positive/negative/neutral",
    "score": -1.0 to +1.0
  },
  "cues": ["vocal cue 1", "vocal cue 2", ...]
}`
              }
            ]
          }
        ] as any,
      } as any);

      // Extract transcript from audio field
      const transcriptFromAudio = response.choices[0]?.message?.audio?.transcript || "";

      const defaultEmotionScores: Record<BasicEmotion, number> = {
        happy: 0,
        sad: 0,
        angry: 0,
        fearful: 0,
        surprised: 0,
        disgusted: 0,
        neutral: 0,
      };
      const defaultMoodScores: Record<MoodState, number> = {
        anxious: 0,
        relaxed: 0,
        frustrated: 0,
        excited: 0,
        focused: 0,
      };

      const emotionsDefault: AudioEmotionAnalysis = {
        emotion: {
          primary: "neutral",
          confidence: 0,
          all: defaultEmotionScores,
        },
        mood: {
          primary: "focused",
          confidence: 0,
          all: defaultMoodScores,
        },
        sentiment: {
          polarity: "neutral",
          score: 0,
        },
        cues: [],
      };

      let transcript = transcriptFromAudio;

      if (!transcript) {
        const fallback = await this.audioExtractor.transcribeAudio(convertedAudioPath);
        if (fallback.success && fallback.transcript) {
          transcript = fallback.transcript;
          console.log("[VideoChatService] Fallback transcript extracted from local Whisper");
        } else if (fallback.error) {
          console.warn("[VideoChatService] Fallback transcript failed:", fallback.error);
        }
      }

      const audioEmotionResult = await this.analyzeAudioEmotions(transcript);
      const emotions = audioEmotionResult.success && audioEmotionResult.analysis
        ? audioEmotionResult.analysis
        : emotionsDefault;

      console.log(`[VideoChatService] Transcript extracted: "${transcript}"`);
      console.log("[VideoChatService] Audio emotion analysis complete");

      return { transcript, emotions };
    } catch (error) {
      console.error("[VideoChatService] GPT-4o audio processing error:", error);
      throw error;
    } finally {
      await Promise.all(
        [originalAudioPath, convertedAudioPath].filter(Boolean).map((filePath) =>
          fs.promises.rm(filePath!, { force: true, maxRetries: 1 }).catch(() => { })
        )
      );
    }
  }

  /**
   * Transcribe audio file (Step 1 - emit transcript immediately)
   * LEGACY: Only used when whisperProvider is "local"
   */
  async transcribeAudio(message: VideoChatMessage): Promise<TranscriptionResult> {
    let tempAudioPath: string | null = null;

    try {
      console.log(`[VideoChatService] Transcribing audio for session ${message.sessionId}`);

      // Save audio to temporary file
      tempAudioPath = await this.saveAudioToTempFile(message.audio);

      let transcript: string;

      if (this.whisperProvider === "openai") {
        // Transcribe using OpenAI Whisper API
        console.log("[VideoChatService] Transcribing with OpenAI Whisper API...");
        if (!this.openai) {
          throw new Error("OpenAI client not initialized");
        }

        const transcription = await this.openai.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioPath),
          model: "whisper-1",
        });

        transcript = transcription.text.trim();
      } else {
        // Transcribe using local Whisper model (Transformers.js)
        console.log("[VideoChatService] Transcribing with local Whisper model...");
        const transcriptionResult = await this.audioExtractor.transcribeAudio(
          tempAudioPath,
          { returnTimestamps: false }
        );

        if (!transcriptionResult.success || !transcriptionResult.transcript) {
          throw new Error(transcriptionResult.error || "Transcription failed");
        }

        transcript = transcriptionResult.transcript.trim();
      }

      console.log(`[VideoChatService] Transcription complete: "${transcript}"`);

      return {
        success: true,
        transcript,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[VideoChatService] Transcription error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Transcription failed",
        timestamp: Date.now(),
      };
    } finally {
      // Clean up temporary file
      if (tempAudioPath) {
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (err) {
          console.warn(
            `[VideoChatService] Failed to delete temp file: ${tempAudioPath}`,
            err
          );
        }
      }
    }
  }

  /**
   * Get initial context for exam session startup
   * Returns a hardcoded introduction - no LLM involved to avoid prompt injection issues
   */
  async getInitialContext(_sessionId: string): Promise<VideoChatResponse> {
    console.log("[VideoChatService] Returning initial exam context...");

    // Hardcoded introduction - bypasses LLM entirely to ensure exact wording
    const introduction = `Before we begin, I need to understand your cultural background so I can ensure our questions and assessment are fair and appropriate for you.

Please tell me briefly: How would you describe your cultural background? For example, your ethnicity, upbringing, any religious beliefs you may have, and your preferred language for this examination.

When you're ready to respond, click the record button at the bottom of the screen to speak, then click it again when you're done.`;

    return {
      success: true,
      response: introduction,
      timestamp: Date.now(),
    };
  }

  /**
   * Invoke Vocal AI graph with transcript (Step 2 - after transcript is shown to user)
   */
  async invokeVocalAI(
    transcript: string,
    sessionId?: string,
    emotionalContext?: {
      video: any | null;
      audio: any | null;
    },
    turnCount?: number,
    topic?: string,
    scenario?: string
  ): Promise<VideoChatResponse & { turnCount?: number; topic?: string; scenario?: string }> {
    try {
      console.log("[VideoChatService] Invoking Vocal AI graph...");

      const graphResult = await this.vocalAIGraph.invoke({
        studentMessage: transcript,
        sessionId: sessionId || 'default-session',
        emotionalContext,
        turnCount: turnCount ?? 0,
        topic,
        scenario,
      });

      console.log("[VideoChatService] Vocal AI response received");

      return {
        success: true,
        transcript,
        response: graphResult.response,
        turnCount: graphResult.turnCount,
        topic: graphResult.topic,
        scenario: graphResult.scenario,
        isFinalAssessment: graphResult.isFinalAssessment,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[VideoChatService] Vocal AI invocation error:", error);
      return {
        success: false,
        transcript,
        error: error instanceof Error ? error.message : "Vocal AI invocation failed",
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Analyze emotions from audio transcript
   */
  async analyzeAudioEmotions(transcript: string): Promise<AudioEmotionResult> {
    try {
      console.log("[VideoChatService] Analyzing audio emotions from transcript...");

      const prompt = `Analyze the emotional content of this spoken text transcript.

Transcript: "${transcript}"

Based on the words, tone indicators, and content, assess:

1. Basic Emotions: Rate each 0-1
   - happy: Positive words, excitement, joy
   - sad: Negative words, disappointment, sorrow
   - angry: Frustration, irritation, hostility
   - fearful: Worry, anxiety, fear
   - surprised: Unexpected reactions, astonishment
   - disgusted: Repulsion, distaste
   - neutral: Calm, matter-of-fact

2. Mood States: Rate each 0-1
   - anxious: Worried tone, hesitation, uncertainty
   - relaxed: Calm, easygoing language
   - frustrated: Impatience, repeated concerns
   - excited: Enthusiasm, energy
   - focused: Clear, purposeful communication

3. Sentiment: Rate -1 to +1 (negative to positive)
   - Overall emotional valence from word choice and content

4. Audio Cues: Specific observations (e.g., "uses positive language", "expresses concern")

Return JSON:
{
  "emotions": {
    "happy": 0-1,
    "sad": 0-1,
    "angry": 0-1,
    "fearful": 0-1,
    "surprised": 0-1,
    "disgusted": 0-1,
    "neutral": 0-1
  },
  "moods": {
    "anxious": 0-1,
    "relaxed": 0-1,
    "frustrated": 0-1,
    "excited": 0-1,
    "focused": 0-1
  },
  "sentiment_score": -1 to +1,
  "audio_cues": ["specific observations"]
}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 500,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.choices[0]?.message?.content || "{}";

      // Extract JSON from response (handle various formats)
      let jsonContent = content.trim();

      // Try to extract from markdown code fences
      if (jsonContent.includes("```")) {
        const jsonMatch = jsonContent.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
        }
      }

      // If still not JSON, try to find JSON object within text
      if (!jsonContent.startsWith("{")) {
        const objectMatch = jsonContent.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonContent = objectMatch[0];
        }
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonContent);
      } catch (parseError) {
        console.error("[VideoChatService] JSON parse error. Raw content:", content.substring(0, 200));
        console.error("[VideoChatService] Extracted JSON:", jsonContent.substring(0, 200));
        throw parseError;
      }

      // Parse emotion analysis
      const emotionEntries = Object.entries(parsed.emotions || {}) as [BasicEmotion, number][];
      const primaryEmotion = emotionEntries.reduce((max, [emotion, score]) =>
        score > max.score ? { emotion, score } : max,
        { emotion: 'neutral' as BasicEmotion, score: 0 }
      );

      // Parse mood analysis
      const moodEntries = Object.entries(parsed.moods || {}) as [MoodState, number][];
      const primaryMood = moodEntries.reduce((max, [mood, score]) =>
        score > max.score ? { mood, score } : max,
        { mood: 'focused' as MoodState, score: 0 }
      );

      // Parse sentiment
      const sentimentScore = parsed.sentiment_score || 0;
      const sentimentPolarity: Sentiment =
        sentimentScore > 0.2 ? 'positive' :
          sentimentScore < -0.2 ? 'negative' : 'neutral';

      const analysis: AudioEmotionAnalysis = {
        emotion: {
          primary: primaryEmotion.emotion,
          confidence: primaryEmotion.score,
          all: parsed.emotions || {} as Record<BasicEmotion, number>,
        },
        mood: {
          primary: primaryMood.mood,
          confidence: primaryMood.score,
          all: parsed.moods || {} as Record<MoodState, number>,
        },
        sentiment: {
          polarity: sentimentPolarity,
          score: sentimentScore,
        },
        cues: parsed.audio_cues || [],
      };

      console.log("[VideoChatService] Audio emotion analysis complete");

      return {
        success: true,
        analysis,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[VideoChatService] Audio emotion analysis error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Audio emotion analysis failed",
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Detect if audio file is silent or too quiet
   * Uses ffmpeg volumedetect filter to measure mean volume
   * Returns true if audio is below -50dB (essentially silent)
   */
  private async detectSilence(audioPath: string): Promise<boolean> {
    try {
      const { stderr } = await execFileAsync("ffmpeg", [
        "-i",
        audioPath,
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-"
      ]);

      // ffmpeg outputs volumedetect results to stderr
      const meanVolumeMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (meanVolumeMatch) {
        const meanVolume = parseFloat(meanVolumeMatch[1]);
        console.log(`[VideoChatService] Audio mean volume: ${meanVolume.toFixed(2)}dB`);

        // Consider audio silent if mean volume is below -50dB
        // Typical speech is around -20dB to -10dB
        // Silence/very quiet audio is below -50dB
        return meanVolume < -50;
      }

      // If we can't detect volume, assume it's not silent (fail open)
      console.warn("[VideoChatService] Could not detect audio volume, assuming not silent");
      return false;
    } catch (error) {
      console.error("[VideoChatService] Error detecting silence:", error);
      // Fail open - if we can't detect silence, allow transcription
      return false;
    }
  }

  private async saveAudioToTempFile(audioBase64: string): Promise<string> {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const tempFilePath = path.join(
      tmpdir(),
      `niimi-voice-${Date.now()}.webm`
    );

    await fs.promises.writeFile(tempFilePath, audioBuffer);
    return tempFilePath;
  }

  /**
   * Convert WebM upload to WAV so GPT accepts it
   */
  private async convertWebMToWav(inputPath: string): Promise<string> {
    const outputPath = path.join(
      tmpdir(),
      `niimi-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
    );

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      outputPath,
    ]);

    return outputPath;
  }
}
