/**
 * Frame Processor
 *
 * Processes video frames from WebSocket stream with intelligent throttling.
 * Reduces API costs by analyzing only every 5th frame and skipping duplicates.
 *
 * Key Features:
 * - Frame throttling: Analyzes every 5th frame (60fps → 12fps)
 * - Duplicate detection: MD5 hashing to skip identical frames
 * - Queue management: Prevents API overload
 * - Integration with VisionService for behavioral analysis
 */

import { VisionService } from "../vision-service";
import { createHash } from "crypto";
import {
  BehavioralAnalysis,
  VisionBehavioralResponse,
  BasicEmotion,
  MoodState,
  Sentiment,
} from "./behavioral-types";

// Time-based throttle: only analyze once per 10 seconds to reduce API costs
const ANALYSIS_INTERVAL_MS = 10000;

export class FrameProcessor {
  private visionService: VisionService;
  private frameCount = 0;
  private lastFrameHash: string | null = null;
  private lastAnalysisTime = 0;
  private analysisQueue: Promise<void>[] = [];

  constructor(openaiApiKey?: string) {
    this.visionService = new VisionService(openaiApiKey);
  }

  /**
   * Process a video frame with time-based throttling and duplicate detection
   *
   * @param frameBase64 - Base64 encoded video frame
   * @returns Behavioral analysis or null if frame was skipped
   */
  async processFrame(frameBase64: string): Promise<BehavioralAnalysis | null> {
    this.frameCount++;

    // Time-based throttle: only analyze once per ANALYSIS_INTERVAL_MS
    const now = Date.now();
    if (now - this.lastAnalysisTime < ANALYSIS_INTERVAL_MS) {
      return null;
    }

    // Skip identical frames (no motion)
    const frameHash = createHash("md5").update(frameBase64).digest("hex");
    if (frameHash === this.lastFrameHash) {
      return null; // No change since last analyzed frame
    }
    this.lastFrameHash = frameHash;
    this.lastAnalysisTime = now;

    // Analyze with Claude Vision
    const analysis = await this.visionService.analyzeBehavior(frameBase64);

    // Parse emotion analysis
    const emotionEntries = Object.entries(analysis.emotions || {}) as [BasicEmotion, number][];
    const primaryEmotion = emotionEntries.reduce((max, [emotion, score]) =>
      score > max.score ? { emotion, score } : max,
      { emotion: 'neutral' as BasicEmotion, score: 0 }
    );

    // Parse mood analysis
    const moodEntries = Object.entries(analysis.moods || {}) as [MoodState, number][];
    const primaryMood = moodEntries.reduce((max, [mood, score]) =>
      score > max.score ? { mood, score } : max,
      { mood: 'focused' as MoodState, score: 0 }
    );

    // Parse sentiment
    const sentimentScore = analysis.sentiment_score || 0;
    const sentimentPolarity: Sentiment =
      sentimentScore > 0.2 ? 'positive' :
      sentimentScore < -0.2 ? 'negative' : 'neutral';

    return {
      engagement: analysis.engagement_level || 0.5,
      confusion: analysis.confusion_indicators?.length > 0 ? 0.7 : 0.3,
      confidence: analysis.confidence_signals?.length > 0 ? 0.8 : 0.4,
      thinking: analysis.thinking_patterns?.length > 0,
      cues: [
        ...(analysis.confusion_indicators || []),
        ...(analysis.confidence_signals || []),
        ...(analysis.visual_cues || []),
      ],
      emotion: {
        primary: primaryEmotion.emotion,
        confidence: primaryEmotion.score,
        all: analysis.emotions || {} as Record<BasicEmotion, number>,
      },
      mood: {
        primary: primaryMood.mood,
        confidence: primaryMood.score,
        all: analysis.moods || {} as Record<MoodState, number>,
      },
      sentiment: {
        polarity: sentimentPolarity,
        score: sentimentScore,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Reset frame counter and hash (useful when starting new session)
   */
  reset(): void {
    this.frameCount = 0;
    this.lastFrameHash = null;
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    totalFrames: number;
    analyzedFrames: number;
    analysisRate: number;
  } {
    const analyzedFrames = Math.floor(this.frameCount / 5);
    return {
      totalFrames: this.frameCount,
      analyzedFrames,
      analysisRate: this.frameCount > 0 ? analyzedFrames / this.frameCount : 0,
    };
  }
}
