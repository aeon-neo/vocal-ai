/**
 * Behavioral Analysis Types
 *
 * Type definitions for real-time video behavioral analysis system.
 * Used by frame processor and vision service for analyzing engagement,
 * emotions, mood states, and behavioral patterns.
 */

export type BasicEmotion =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'surprised'
  | 'disgusted'
  | 'neutral';

export type MoodState =
  | 'anxious'
  | 'relaxed'
  | 'frustrated'
  | 'excited'
  | 'focused';

export type Sentiment = 'positive' | 'negative' | 'neutral';

export interface EmotionAnalysis {
  primary: BasicEmotion;
  confidence: number;      // 0-1 confidence in primary emotion
  all: Record<BasicEmotion, number>;  // Scores for all 7 emotions
}

export interface MoodAnalysis {
  primary: MoodState;
  confidence: number;      // 0-1 confidence in primary mood
  all: Record<MoodState, number>;     // Scores for all 5 moods
}

export interface SentimentAnalysis {
  polarity: Sentiment;
  score: number;          // -1 to +1 (negative to positive)
}

export interface BehavioralAnalysis {
  engagement: number;        // 0-1 (low to high)
  confusion: number;         // 0-1 (clear to confused)
  confidence: number;        // 0-1 (uncertain to confident)
  thinking: boolean;         // Pausing, looking up (cognitive processing)
  cues: string[];           // ["furrowed brow", "looking away", etc.]
  emotion: EmotionAnalysis;
  mood: MoodAnalysis;
  sentiment: SentimentAnalysis;
  timestamp: number;
}

export interface VideoFrameData {
  sessionId: string;
  frame: string;            // Base64 encoded image
  timestamp: number;
}

export interface BehavioralCuesEvent {
  timestamp: number;
  engagement: number;
  confusion: number;
  confidence: number;
  thinking: boolean;
  cues: string[];
  emotion: EmotionAnalysis;
  mood: MoodAnalysis;
  sentiment: SentimentAnalysis;
}

export interface VisionBehavioralResponse {
  engagement_level: number;
  confusion_indicators: string[];
  confidence_signals: string[];
  thinking_patterns: string[];
  emotions: Record<BasicEmotion, number>;
  moods: Record<MoodState, number>;
  sentiment_score: number;  // -1 to +1
  visual_cues: string[];
}
