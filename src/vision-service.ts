import OpenAI from "openai";
import { ImageExtractor, ImageData } from "./utils/image-extractor";
import { VideoExtractor, ExtractedFrame } from "./utils/video-extractor";
import { VisionBehavioralResponse } from "./websocket/behavioral-types";

/**
 * Vision Service
 *
 * Service for analyzing images and videos using OpenAI GPT-4o vision capabilities.
 * Supports single images, multiple images, and video frame analysis.
 */

export interface VisionAnalysisResult {
  success: boolean;
  analysis?: string;
  error?: string;
  metadata?: {
    model: string;
    tokensUsed?: number;
    processingTime?: number;
  };
}

export class VisionService {
  private openai: OpenAI;

  constructor(openaiApiKey?: string) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Analyze a single image with optional query
   *
   * @param imageData - Image data (base64 encoded)
   * @param query - Optional question or instruction about the image
   * @param options - Analysis options (model, maxTokens, etc.)
   */
  async analyzeImage(
    imageData: ImageData,
    query?: string,
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<VisionAnalysisResult> {
    const startTime = Date.now();

    try {
      const model = options.model || "gpt-4o";
      const maxTokens = options.maxTokens || 2000;
      const temperature = options.temperature || 0;

      // Build message content with image (OpenAI format)
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
          type: 'image_url',
          image_url: {
            url: `data:${imageData.mediaType};base64,${imageData.base64}`,
            detail: 'high'
          }
        },
        {
          type: 'text',
          text: query || 'Please analyze this image in detail. Describe what you see, including objects, people, text, colors, composition, and any other notable features.'
        }
      ];

      const response = await this.openai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content
          }
        ]
      });

      const analysis = response.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        analysis,
        metadata: {
          model,
          tokensUsed: response.usage ? response.usage.prompt_tokens + response.usage.completion_tokens : undefined,
          processingTime
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze image: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Analyze multiple images with optional query
   *
   * @param images - Array of image data
   * @param query - Optional question or instruction about the images
   * @param options - Analysis options
   */
  async analyzeMultipleImages(
    images: ImageData[],
    query?: string,
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<VisionAnalysisResult> {
    const startTime = Date.now();

    try {
      const model = options.model || "gpt-4o";
      const maxTokens = options.maxTokens || 4000;
      const temperature = options.temperature || 0;

      // Build message content with all images (OpenAI format)
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

      // Add all images
      for (let i = 0; i < images.length; i++) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${images[i].mediaType};base64,${images[i].base64}`,
            detail: 'high'
          }
        });
      }

      // Add text query
      content.push({
        type: 'text',
        text: query || `Please analyze these ${images.length} images. Describe what you see in each image and how they relate to each other, if applicable.`
      });

      const response = await this.openai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content
          }
        ]
      });

      const analysis = response.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        analysis,
        metadata: {
          model,
          tokensUsed: response.usage ? response.usage.prompt_tokens + response.usage.completion_tokens : undefined,
          processingTime
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze images: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Analyze video frames
   *
   * @param frames - Extracted video frames
   * @param query - Optional question or instruction about the video
   * @param options - Analysis options
   */
  async analyzeVideoFrames(
    frames: ExtractedFrame[],
    query?: string,
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<VisionAnalysisResult> {
    const startTime = Date.now();

    try {
      const model = options.model || "gpt-4o";
      const maxTokens = options.maxTokens || 4000;
      const temperature = options.temperature || 0;

      // Build message content with all frames (OpenAI format)
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

      // Add all frames with timestamps
      for (const frame of frames) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${frame.mediaType};base64,${frame.base64}`,
            detail: 'high'
          }
        });
      }

      // Add text query with frame context
      const frameTimestamps = frames.map(f =>
        `Frame ${f.frameNumber + 1} at ${f.timestamp.toFixed(1)}s`
      ).join(', ');

      content.push({
        type: 'text',
        text: query
          ? `These are frames extracted from a video: ${frameTimestamps}.\n\n${query}`
          : `These are ${frames.length} frames extracted from a video at these timestamps: ${frameTimestamps}.\n\nPlease analyze the video based on these frames. Describe what happens in the video, including actions, scenes, objects, people, and any progression or story you can identify.`
      });

      const response = await this.openai.chat.completions.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content
          }
        ]
      });

      const analysis = response.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        analysis,
        metadata: {
          model,
          tokensUsed: response.usage ? response.usage.prompt_tokens + response.usage.completion_tokens : undefined,
          processingTime
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze video frames: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Extract text from image (OCR)
   *
   * @param imageData - Image data
   */
  async extractTextFromImage(imageData: ImageData): Promise<VisionAnalysisResult> {
    return this.analyzeImage(
      imageData,
      'Please extract and transcribe all text visible in this image. Maintain the original formatting and structure as much as possible.',
      { maxTokens: 3000 }
    );
  }

  /**
   * Compare two images
   *
   * @param image1 - First image
   * @param image2 - Second image
   * @param query - Optional specific comparison question
   */
  async compareImages(
    image1: ImageData,
    image2: ImageData,
    query?: string
  ): Promise<VisionAnalysisResult> {
    const defaultQuery = 'Please compare these two images. Describe the similarities and differences between them, including visual elements, composition, style, and content.';

    return this.analyzeMultipleImages(
      [image1, image2],
      query || defaultQuery,
      { maxTokens: 3000 }
    );
  }

  /**
   * Analyze behavioral cues and emotional state from a video frame
   *
   * Detects engagement, confusion, confidence, thinking patterns,
   * emotions, mood states, and sentiment for real-time analysis.
   *
   * @param imageBase64 - Base64 encoded video frame
   * @returns Behavioral analysis with engagement/emotions/mood scores
   */
  async analyzeBehavior(imageBase64: string): Promise<VisionBehavioralResponse> {
    const prompt = `Analyze this person's behavioral cues, emotions, and mood state.

Focus on:
1. Engagement: Eye contact, attention to screen, posture
2. Confusion: Furrowed brow, hesitation, looking away
3. Confidence: Upright posture, steady gaze, gesture use
4. Thinking: Pauses, looking up/away (cognitive processing)

5. Basic Emotions (facial expressions): Rate each 0-1
   - happy: Smiling, bright eyes, relaxed face
   - sad: Downturned mouth, drooping eyes, furrowed brow
   - angry: Tense jaw, narrowed eyes, furrowed brow
   - fearful: Wide eyes, raised eyebrows, tense expression
   - surprised: Raised eyebrows, wide eyes, open mouth
   - disgusted: Wrinkled nose, raised upper lip
   - neutral: Relaxed, no strong expression

6. Mood States (overall affective state): Rate each 0-1
   - anxious: Fidgeting, tense posture, worried expression
   - relaxed: Calm posture, soft expression, ease
   - frustrated: Clenched jaw, sighing, tense gestures
   - excited: Animated, energetic, bright expression
   - focused: Concentrated gaze, still posture, engaged

7. Sentiment: Rate -1 to +1 (negative to positive)
   - Overall emotional valence from facial expression and body language

8. Visual Cues: Specific observations (e.g., "slight smile", "furrowed brow")

Return JSON:
{
  "engagement_level": 0-1,
  "confusion_indicators": ["furrowed brow", "looking down"],
  "confidence_signals": ["steady eye contact", "upright posture"],
  "thinking_patterns": ["looking up while pausing"],
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
  "visual_cues": ["specific observable behaviors"]
}`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 800,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
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

    try {
      return JSON.parse(jsonContent);
    } catch (parseError) {
      console.error("[VisionService] JSON parse error. Raw content:", content.substring(0, 200));
      console.error("[VisionService] Extracted JSON:", jsonContent.substring(0, 200));
      throw parseError;
    }
  }

  /**
   * Analyze physical appearance from a video frame
   *
   * Extracts detailed physical description including:
   * - Hair (color, style, length)
   * - Facial features (facial hair, glasses, distinctive features)
   * - Clothing/accessories
   * - Estimated age range
   * - Gender presentation
   * - Ethnicity (general)
   * - Distinctive characteristics
   *
   * Used for: User profile enhancement, change detection, identity verification
   *
   * @param imageBase64 - Base64 encoded video frame
   * @returns Physical appearance description as JSON
   */
  async analyzeAppearance(imageBase64: string): Promise<{
    hair: {
      color: string;
      style: string;
      length: string;
    };
    facialFeatures: {
      facialHair: string | null;
      glasses: boolean;
      glassesType: string | null;
      distinctiveFeatures: string[];
    };
    clothing: {
      upperBody: string;
      accessories: string[];
    };
    demographics: {
      estimatedAgeRange: string;
      genderPresentation: string;
    };
    distinctiveCharacteristics: string[];
    overallDescription: string;
    confidence: number;
  }> {
    const prompt = `Analyze this person's physical appearance in detail. Be objective and descriptive.

Focus on:
1. Hair: Color, style (straight/curly/wavy), length (short/medium/long)
2. Facial Features:
   - Facial hair: Type (beard/mustache/stubble/clean-shaven) or null if none
   - Glasses: true/false
   - Glasses type: "prescription", "sunglasses", "reading", etc. or null
   - Distinctive features: scars, freckles, dimples, birthmarks, etc.
3. Clothing:
   - Upper body: Color and style (t-shirt, button-down, sweater, etc.)
   - Accessories: hat, jewelry, watch, earrings, etc.
4. Demographics:
   - Estimated age range: "teens", "20s", "30s", "40s", "50s+", etc.
   - Gender presentation: "masculine", "feminine", "androgynous"
5. Distinctive Characteristics: Any unique or memorable features
6. Overall Description: One sentence summarizing their appearance
7. Confidence: 0-1 score for how clear/visible the person is in the frame

Return valid JSON:
{
  "hair": {
    "color": "brown",
    "style": "straight",
    "length": "short"
  },
  "facialFeatures": {
    "facialHair": "short beard",
    "glasses": true,
    "glassesType": "prescription",
    "distinctiveFeatures": ["dimples", "freckles"]
  },
  "clothing": {
    "upperBody": "blue t-shirt",
    "accessories": ["watch", "necklace"]
  },
  "demographics": {
    "estimatedAgeRange": "30s",
    "genderPresentation": "masculine"
  },
  "distinctiveCharacteristics": ["broad smile", "athletic build"],
  "overallDescription": "Man in his 30s with short brown hair, glasses, and a blue t-shirt",
  "confidence": 0.9
}`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
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

    try {
      return JSON.parse(jsonContent);
    } catch (parseError) {
      console.error("[VisionService] JSON parse error for appearance. Raw content:", content.substring(0, 200));
      console.error("[VisionService] Extracted JSON:", jsonContent.substring(0, 200));
      throw parseError;
    }
  }
}
