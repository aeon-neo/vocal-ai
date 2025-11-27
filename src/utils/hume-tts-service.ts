/**
 * Hume Octave TTS Service
 * Emotionally expressive text-to-speech using Hume AI's Octave model
 *
 * Integrates with Limbic system to modulate voice tone based on relationship state
 */

import { HumeClient } from 'hume';

export interface RelationshipState {
  relationshipStrength: number;
  communicationStyle: {
    warmth: number;
    formality: number;
    humor: number;
    directness: number;
    empathy: number;
  };
}

export interface EmotionalContext {
  primaryEmotion?: string;
  confidence?: number;
  sentiment?: string;
}

export interface HumeTTSOptions {
  voice?: string;
  limbicState?: RelationshipState;
  emotionalContext?: EmotionalContext;
}

export class HumeTTSService {
  private client: HumeClient;
  private defaultVoice: string = 'KORA'; // Default Hume voice ID

  constructor(apiKey?: string) {
    const key = apiKey || process.env.HUME_API_KEY;

    if (!key) {
      throw new Error('HUME_API_KEY must be set in .env or provided to constructor');
    }

    this.client = new HumeClient({ apiKey: key });
  }

  /**
   * Generate acting instructions based on Limbic relationship state
   * These natural language instructions control emotional delivery
   */
  private generateActingInstructions(
    limbicState?: RelationshipState,
    emotionalContext?: EmotionalContext
  ): string {
    if (!limbicState) {
      return 'Speak naturally with warmth and clarity';
    }

    const { communicationStyle, relationshipStrength } = limbicState;
    const instructions: string[] = [];

    // Base warmth
    if (communicationStyle.warmth > 0.7) {
      instructions.push('warm and affectionate');
    } else if (communicationStyle.warmth > 0.4) {
      instructions.push('friendly and approachable');
    } else {
      instructions.push('professional and clear');
    }

    // Formality
    if (communicationStyle.formality > 0.7) {
      instructions.push('formal and respectful');
    } else if (communicationStyle.formality < 0.3) {
      instructions.push('casual and relaxed');
    }

    // Empathy (especially important for emotional contexts)
    if (communicationStyle.empathy > 0.7) {
      instructions.push('empathetic and understanding');
    }

    // Humor
    if (communicationStyle.humor > 0.6) {
      instructions.push('with subtle playfulness');
    }

    // Directness
    if (communicationStyle.directness > 0.7) {
      instructions.push('direct and concise');
    } else if (communicationStyle.directness < 0.3) {
      instructions.push('gentle and thoughtful');
    }

    // Respond to user's emotional state if detected
    if (emotionalContext?.primaryEmotion) {
      const { primaryEmotion, confidence } = emotionalContext;

      if (confidence && confidence > 0.5) {
        if (primaryEmotion === 'sad') {
          instructions.push('comforting and supportive');
        } else if (primaryEmotion === 'angry') {
          instructions.push('calm and patient');
        } else if (primaryEmotion === 'fearful') {
          instructions.push('reassuring and steady');
        } else if (primaryEmotion === 'happy') {
          instructions.push('uplifting and positive');
        }
      }
    }

    // Relationship strength affects overall tone
    if (relationshipStrength > 5) {
      instructions.push('like speaking to a close friend');
    } else if (relationshipStrength < -2) {
      instructions.push('carefully and respectfully');
    }

    return `Speak ${instructions.join(', ')} with natural pacing and clear articulation`;
  }

  /**
   * Synthesize speech from text with emotional modulation
   * Returns base64 encoded audio (MP3 format)
   */
  async synthesizeSpeech(
    text: string,
    options: HumeTTSOptions = {}
  ): Promise<string> {
    try {
      const actingInstructions = this.generateActingInstructions(
        options.limbicState,
        options.emotionalContext
      );

      const voiceName = options.voice || this.defaultVoice;

      console.log(`[HumeTTS] Synthesizing: "${text.substring(0, 50)}..."`);
      console.log(`[HumeTTS] Acting instructions: "${actingInstructions}"`);
      console.log(`[HumeTTS] Voice: ${voiceName}`);

      // Use streaming API for low latency
      // Note: Using version "1" because it supports 'description' for emotional acting instructions
      // Octave 2 (version "2") does not support the description parameter
      let stream;
      try {
        stream = await this.client.tts.synthesizeJsonStreaming({
          utterances: [{
            text: text,
            voice: {
              name: voiceName,
              provider: 'HUME_AI' as const
            },
            description: actingInstructions
          }],
          stripHeaders: true,
          version: "1"
        });
      } catch (apiError: any) {
        console.error('[HumeTTS] API request failed:', apiError.message);
        console.error('[HumeTTS] Error name:', apiError.name);
        console.error('[HumeTTS] Error details:', JSON.stringify(apiError, null, 2));
        if (apiError.body) {
          console.error('[HumeTTS] Error body:', JSON.stringify(apiError.body, null, 2));
        }
        if (apiError.response) {
          console.error('[HumeTTS] Error response:', JSON.stringify(apiError.response, null, 2));
        }
        throw new Error(`Hume TTS API request failed: ${apiError.message}. Check console for details.`);
      }

      // Collect audio chunks
      const audioChunks: Buffer[] = [];

      try {
        for await (const chunk of stream) {
          // Handle different chunk types
          if (chunk.type === 'audio') {
            const buffer = Buffer.from(chunk.audio, 'base64');
            audioChunks.push(buffer);
          } else if ((chunk as any).type === 'error') {
            console.error('[HumeTTS] Stream error chunk:', chunk);
            throw new Error(`TTS stream error: ${JSON.stringify(chunk)}`);
          } else {
            // Log unexpected chunk types for debugging
            console.log(`[HumeTTS] Received chunk type: ${chunk.type}`);
          }
        }
      } catch (streamError: any) {
        // Handle stream parsing errors
        if (streamError.name === 'ParseError') {
          console.error('[HumeTTS] Stream ParseError - API returned error chunk instead of audio');
          console.error('[HumeTTS] ParseError message:', streamError.message);
          console.error('[HumeTTS] ParseError details:', JSON.stringify(streamError, null, 2));

          if (streamError.errors) {
            console.error('[HumeTTS] Validation errors:', JSON.stringify(streamError.errors, null, 2));
          }

          // Try to extract the actual API error from the parse error
          const errorMatch = streamError.message?.match(/Expected "audio"\. Received "([^"]+)"/);
          if (errorMatch) {
            console.error('[HumeTTS] Hume API returned chunk type:', errorMatch[1]);
          }

          // Check if we got any audio before the error
          if (audioChunks.length > 0) {
            console.log(`[HumeTTS] Returning partial audio (${audioChunks.length} chunks received before error)`);
          } else {
            throw new Error(`TTS streaming failed: API returned "${errorMatch?.[1] || 'error'}" chunk instead of audio. Possible causes: invalid voice name, API quota exceeded, rate limiting, or API key issues.`);
          }
        } else {
          throw streamError;
        }
      }

      if (audioChunks.length === 0) {
        throw new Error('No audio chunks received from TTS service');
      }

      // Combine all chunks and convert to base64
      const completeAudio = Buffer.concat(audioChunks);
      const base64Audio = completeAudio.toString('base64');

      console.log(`[HumeTTS] Synthesis complete: ${base64Audio.length} chars from ${audioChunks.length} chunks`);

      return base64Audio;

    } catch (error: any) {
      console.error('[HumeTTS] Error synthesizing speech:', error.message);
      if (error.body) {
        console.error('[HumeTTS] Error body:', JSON.stringify(error.body, null, 2));
      }
      throw error;
    }
  }

  /**
   * Synthesize speech with streaming for real-time playback
   * Returns async generator of base64 audio chunks
   */
  async *synthesizeSpeechStreaming(
    text: string,
    options: HumeTTSOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    try {
      const actingInstructions = this.generateActingInstructions(
        options.limbicState,
        options.emotionalContext
      );

      const voiceName = options.voice || this.defaultVoice;

      console.log(`[HumeTTS] Streaming synthesis: "${text.substring(0, 50)}..."`);
      console.log(`[HumeTTS] Acting instructions: "${actingInstructions}"`);
      console.log(`[HumeTTS] Voice: ${voiceName}`);

      const stream = await this.client.tts.synthesizeJsonStreaming({
        utterances: [{
          text: text,
          voice: {
            name: voiceName,
            provider: 'HUME_AI' as const
          },
          description: actingInstructions
        }],
        stripHeaders: true,
        version: "1"
      });

      for await (const chunk of stream) {
        if (chunk.type === 'audio') {
          // Yield base64 chunk directly (no need to convert)
          yield chunk.audio;
        }
      }

      console.log(`[HumeTTS] Streaming complete`);

    } catch (error: any) {
      console.error('[HumeTTS] Error streaming speech:', error.message);
      throw error;
    }
  }

  /**
   * Test the TTS service with a simple message
   */
  async test(): Promise<void> {
    console.log('[HumeTTS] Running test synthesis...');

    const testText = 'Hello! I am Niimi, your emotionally intelligent assistant. How can I help you today?';

    try {
      const audio = await this.synthesizeSpeech(testText, {
        limbicState: {
          relationshipStrength: 0,
          communicationStyle: {
            warmth: 0.7,
            formality: 0.4,
            humor: 0.5,
            directness: 0.6,
            empathy: 0.7
          }
        }
      });

      console.log(`[HumeTTS] Test successful! Generated ${audio.length} chars of base64 audio`);
      console.log(`[HumeTTS] Service is ready for use`);

    } catch (error: any) {
      console.error('[HumeTTS] Test failed:', error.message);
      throw error;
    }
  }
}
