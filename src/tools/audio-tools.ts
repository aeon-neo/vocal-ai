import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { FileValidator } from "../utils/file-validator";
import { getBestMatch, resolvePath, getDocumentDirectory } from "../utils/filename-matcher";
import { PostgresService } from "../storage";

/**
 * Audio Tools
 *
 * Tools for transcribing and analyzing audio files using OpenAI Whisper + Claude.
 */

/**
 * Analyze Audio Tool
 *
 * Transcribes and analyzes an audio file from ~/niimi-documents/ using Whisper + Claude.
 * Supports common audio formats: MP3, WAV, M4A, FLAC, OGG, AAC, WMA.
 *
 * This is an async operation - transcription is queued and processed in the background.
 * User will receive a notification when complete.
 */
export function createAnalyzeAudioTool(
  storageService: PostgresService,
  motorAgent: any
) {
  return tool(
    async ({ fileName, query }) => {
      try {
        // Try to resolve filename
        let filePath = resolvePath(fileName);

        // If direct resolution fails, try fuzzy matching
        if (!filePath) {
          const matches = getBestMatch(fileName);

          if (matches.length === 0) {
            return JSON.stringify({
              success: false,
              error: "No matching audio files found",
              suggestion: `Try listing documents with 'list documents' or place your audio file in ${getDocumentDirectory()}`
            });
          }

          if (matches.length > 1) {
            return JSON.stringify({
              success: false,
              error: "Multiple matching files found",
              matches: matches.map(m => ({
                fileName: m.fileName,
                score: m.score
              })),
              suggestion: "Please specify which audio file you want to analyze"
            });
          }

          filePath = matches[0].fullPath;
          fileName = matches[0].fileName;
        }

        // Validate audio file
        const validation = FileValidator.validateAudio(filePath);
        if (!validation.valid) {
          return JSON.stringify({
            success: false,
            error: validation.error
          });
        }

        // Queue audio analysis action to Motor (background processing)
        const actionId = await storageService.query(
          `INSERT INTO action_queue (action_type, status, payload, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id`,
          ['analyze_audio', 'pending', JSON.stringify({ filePath, fileName, query })]
        );

        const id = actionId.rows[0].id;

        // Trigger Motor to process the queue (fire-and-forget)
        motorAgent.processActionQueue().catch((error: any) => {
          console.error('[AudioTools] Error triggering Motor:', error);
        });

        // Return action ID so user can check status later
        return JSON.stringify({
          success: true,
          message: `I'm analyzing "${fileName}" in the background. This will take 2-5 minutes. I'll let you know when it's complete, or you can check the status with "check processing queue".`,
          actionId: id,
          fileName: fileName,
          estimatedTime: "2-5 minutes"
        });

      } catch (error: any) {
        console.error('[AudioTools] Error in analyze_audio:', error);
        return JSON.stringify({
          success: false,
          error: error.message || 'Unknown error analyzing audio'
        });
      }
    },
    {
      name: "analyze_audio",
      description: `Queue audio transcription and analysis using local Whisper model + Claude.

Supports: MP3, WAV, M4A, FLAC, OGG, AAC, WMA.

IMPORTANT: This queues the work to run in the background. Tell the user it will take 2-5 minutes and they'll be notified when complete. The user can ask "check processing queue" or "what content has been created" to check status and retrieve results.

Use 'query' parameter to specify what to analyze (e.g., "summarize the key points", "extract action items").`,
      schema: z.object({
        fileName: z.string().describe("Name of the audio file (e.g., 'meeting-recording.mp3', 'podcast.m4a')"),
        query: z.string().optional().describe("Optional: What to analyze (e.g., 'summarize key points', 'extract action items'). Defaults to general analysis.")
      })
    }
  );
}

/**
 * Transcribe Audio Tool
 *
 * Transcribes an audio file to text using OpenAI Whisper.
 * Faster than analyze_audio as it only transcribes without Claude analysis.
 *
 * This is an async operation - transcription is queued and processed in the background.
 */
export function createTranscribeAudioTool(
  storageService: PostgresService,
  motorAgent: any
) {
  return tool(
    async ({ fileName, includeTimestamps }) => {
      try {
        // Try to resolve filename
        let filePath = resolvePath(fileName);

        // If direct resolution fails, try fuzzy matching
        if (!filePath) {
          const matches = getBestMatch(fileName);

          if (matches.length === 0) {
            return JSON.stringify({
              success: false,
              error: "No matching audio files found",
              suggestion: `Try listing documents with 'list documents' or place your audio file in ${getDocumentDirectory()}`
            });
          }

          if (matches.length > 1) {
            return JSON.stringify({
              success: false,
              error: "Multiple matching files found",
              matches: matches.map(m => ({
                fileName: m.fileName,
                score: m.score
              })),
              suggestion: "Please specify which audio file you want to transcribe"
            });
          }

          filePath = matches[0].fullPath;
          fileName = matches[0].fileName;
        }

        // Validate audio file
        const validation = FileValidator.validateAudio(filePath);
        if (!validation.valid) {
          return JSON.stringify({
            success: false,
            error: validation.error
          });
        }

        // Queue transcription action to Motor
        const actionId = await storageService.query(
          `INSERT INTO action_queue (action_type, status, payload, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id`,
          ['transcribe_audio', 'pending', JSON.stringify({ filePath, fileName, includeTimestamps })]
        );

        const id = actionId.rows[0].id;

        // Trigger Motor to process the queue (fire-and-forget)
        motorAgent.processActionQueue().catch((error: any) => {
          console.error('[AudioTools] Error triggering Motor:', error);
        });

        return JSON.stringify({
          success: true,
          message: `Audio transcription queued for "${fileName}". You will receive a notification when complete.`,
          actionId: id,
          estimatedTime: "1-3 minutes depending on audio length"
        });

      } catch (error: any) {
        console.error('[AudioTools] Error in transcribe_audio:', error);
        return JSON.stringify({
          success: false,
          error: error.message || 'Unknown error transcribing audio'
        });
      }
    },
    {
      name: "transcribe_audio",
      description: `Transcribe an audio file to text using local Whisper model (Transformers.js).

Supports formats: MP3, WAV, M4A, FLAC, OGG, AAC, WMA.

This is an ASYNC operation - the audio will be transcribed in the background and you'll receive the transcript when complete. Uses local Whisper-base model (no API key needed). Use this when the user just wants the raw transcription without additional analysis.

Set includeTimestamps to true to get timestamps for each segment.`,
      schema: z.object({
        fileName: z.string().describe("Name of the audio file (e.g., 'meeting-recording.mp3', 'interview.wav')"),
        includeTimestamps: z.boolean().optional().describe("Include timestamps for each segment (default: false)")
      })
    }
  );
}
