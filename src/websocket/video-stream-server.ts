/**
 * Video Stream Server
 *
 * WebSocket server for real-time video frame analysis.
 * Receives video frames from browser, analyzes behavioral cues,
 * and broadcasts results back to connected clients.
 *
 * Key Features:
 * - Socket.IO for bi-directional WebSocket communication
 * - Session-based rooms for multi-client support
 * - Real-time frame processing with <2s latency
 * - Automatic reconnection handling
 * - Integration with FrameProcessor for behavioral analysis
 */

import { Server, Socket } from "socket.io";
import { createServer, Server as HTTPServer } from "http";
import express from "express";
import cors from "cors";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { randomUUID } from "crypto";
import { FrameProcessor } from "./frame-processor";
import { VideoFrameData, BehavioralCuesEvent } from "./behavioral-types";
import { VideoChatService, WhisperProvider } from "./video-chat-service";
import { VocalAIGraph } from "../langgraph/graph";
import { FileValidator } from "../utils/file-validator";
import { EventBus } from "../event-bus";
import { HumeTTSService } from "../utils/hume-tts-service";
import { AppearanceService } from "../appearance-service";
import { PostgresService } from "../storage";
import { VisionService } from "../vision-service";

// Confidence thresholds for emotion detection
// Only report emotions with confidence above these thresholds
const MIN_VIDEO_EMOTION_CONFIDENCE = 0.45; // 45% confidence for video emotions
const MIN_AUDIO_EMOTION_CONFIDENCE = 0.25; // 25% confidence for audio emotions (Hume AI prosody analysis)

export interface VideoStreamServerConfig {
  port?: number;
  corsOrigin?: string | string[];
  maxHttpBufferSize?: number;
  openaiApiKey?: string;
  vocalAIGraph?: VocalAIGraph; // Optional - for video chat integration
  whisperProvider?: WhisperProvider; // Optional - whisper provider type
}

interface SessionEmotionalState {
  videoEmotion?: any; // Latest video emotion analysis (from behavioral-cues)
  audioEmotion?: any; // Latest audio emotion analysis (from audio transcription)
  lastVideoUpdate?: number; // Timestamp of last video emotion update
  lastAudioUpdate?: number; // Timestamp of last audio emotion update
  lastAppearanceCheck?: number; // Timestamp of last appearance analysis
  appearanceChangeSummary?: string | null; // Summary of detected appearance changes
  turnCount: number; // Current turn in the examination (0 = cultural preferences, 1+ = exam questions)
  topic?: string; // Current examination topic (set by ExamPrep agent)
  scenario?: string; // The full scenario text presented to the student (set by ExamPrep agent)
}

export class VideoStreamServer {
  private io: Server;
  private app: express.Application;
  private httpServer: HTTPServer;
  private frameProcessor: FrameProcessor;
  private chatService?: VideoChatService;
  private ttsService?: HumeTTSService;
  private appearanceService?: AppearanceService;
  private port: number;
  private sessionStates: Map<string, SessionEmotionalState>; // Track emotional state per session
  private sessionAssignments: Map<string, string>;

  constructor(config: VideoStreamServerConfig = {}) {
    this.port = config.port || 5443;
    this.app = express();
    this.httpServer = createServer(this.app);
    this.sessionStates = new Map(); // Initialize session state tracker
    this.sessionAssignments = new Map(); // Track socket => session IDs

    // Configure CORS for Express routes
    this.app.use(cors({
      origin: config.corsOrigin || "*",
      credentials: true,
    }));

    // Serve static files from public/ directory
    this.app.use(express.static("public"));
    this.app.use(express.json());

    // Configure multer for file uploads
    const documentDir = process.env.DOCUMENT_DIRECTORY
      ? process.env.DOCUMENT_DIRECTORY.replace(/^~/, os.homedir())
      : path.join(os.homedir(), 'niimi-documents');

    // Ensure document directory exists
    if (!fs.existsSync(documentDir)) {
      fs.mkdirSync(documentDir, { recursive: true });
    }

    const upload = multer({
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          cb(null, documentDir);
        },
        filename: (req, file, cb) => {
          // Use original filename (overwrite if exists)
          cb(null, file.originalname);
        }
      }),
      limits: {
        fileSize: 500 * 1024 * 1024 // 500MB max (largest supported file type)
      }
    });

    // File upload endpoint
    this.app.post("/upload-attachment", upload.array('files'), (req, res) => {
      try {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No files uploaded'
          });
        }

        const results = [];
        const errors = [];

        for (const file of files) {
          const filePath = path.join(documentDir, file.originalname);
          const extension = path.extname(file.originalname).toLowerCase();

          // Validate file based on type
          let validation;
          if (FileValidator.getSupportedExtensions().includes(extension)) {
            validation = FileValidator.validateDocument(filePath);
          } else if (FileValidator.getSupportedImageExtensions().includes(extension)) {
            validation = FileValidator.validateImage(filePath);
          } else if (FileValidator.getSupportedVideoExtensions().includes(extension)) {
            validation = FileValidator.validateVideo(filePath);
          } else if (FileValidator.getSupportedAudioExtensions().includes(extension)) {
            validation = FileValidator.validateAudio(filePath);
          } else {
            // Delete unsupported file
            fs.unlinkSync(filePath);
            errors.push({
              filename: file.originalname,
              error: `Unsupported file type: ${extension}`
            });
            continue;
          }

          if (!validation.valid) {
            // Delete invalid file
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            errors.push({
              filename: file.originalname,
              error: validation.error
            });
          } else {
            results.push({
              filename: file.originalname,
              size: file.size,
              sizeFormatted: FileValidator.formatFileSize(file.size),
              path: filePath
            });
          }
        }

        // Return response
        if (results.length === 0 && errors.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'All files failed validation',
            errors
          });
        }

        res.json({
          success: true,
          files: results,
          errors: errors.length > 0 ? errors : undefined
        });

        console.log(`[VideoStream] Uploaded ${results.length} file(s) to ${documentDir}`);
      } catch (error) {
        console.error('[VideoStream] Upload error:', error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Upload failed'
        });
      }
    });

    // Voice sample endpoint
    this.app.post("/api/voice-sample", async (req, res) => {
      try {
        const { voice, text } = req.body;

        if (!voice || !text) {
          return res.status(400).json({
            success: false,
            error: 'Voice and text are required'
          });
        }

        if (!process.env.HUME_API_KEY) {
          return res.status(503).json({
            success: false,
            error: 'TTS service not available'
          });
        }

        console.log(`[VideoStream] Generating voice sample for: ${voice}`);

        try {
          // Create a fresh TTS service instance for each request to avoid state issues
          const freshTTSService = new HumeTTSService(process.env.HUME_API_KEY);

          // Generate voice sample with neutral emotional state
          const audioBase64 = await freshTTSService.synthesizeSpeech(text, {
            voice: voice,
            limbicState: {
              relationshipStrength: 0,
              communicationStyle: {
                warmth: 0.6,
                formality: 0.4,
                humor: 0.3,
                directness: 0.5,
                empathy: 0.6
              }
            }
          });

          res.json({
            success: true,
            audio: audioBase64
          });

          console.log(`[VideoStream] Voice sample generated successfully (${audioBase64.length} chars)`);
        } catch (ttsError: any) {
          console.error('[VideoStream] TTS synthesis failed:', ttsError);
          if (ttsError.body) {
            console.error('[VideoStream] TTS error body:', JSON.stringify(ttsError.body, null, 2));
          }
          // Return error but don't crash
          res.status(500).json({
            success: false,
            error: 'Voice synthesis failed. Please try again.'
          });
        }

      } catch (error) {
        console.error('[VideoStream] Voice sample error:', error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate voice sample'
        });
      }
    });

    // Initialize Socket.IO server
    this.io = new Server(this.httpServer, {
      cors: {
        origin: config.corsOrigin || "*", // Restrict in production
        methods: ["GET", "POST"],
      },
      maxHttpBufferSize: config.maxHttpBufferSize || 1e7, // 10MB for video frames
    });

    // Initialize frame processor
    this.frameProcessor = new FrameProcessor(config.openaiApiKey);

    // Initialize chat service if graph provided
    if (config.vocalAIGraph) {
      const whisperProvider = config.whisperProvider || "openai";
      this.chatService = new VideoChatService(
        config.vocalAIGraph,
        whisperProvider,
        config.openaiApiKey
      );
      console.log(`[VideoStream] Chat service initialized with ${whisperProvider} Whisper`);
    }

    // Initialize Hume TTS service if API key available
    if (process.env.HUME_API_KEY) {
      try {
        this.ttsService = new HumeTTSService();
        console.log('[VideoStream] Hume TTS service initialized for emotionally expressive voice');
      } catch (error) {
        console.warn('[VideoStream] Failed to initialize Hume TTS service:', error);
      }
    } else {
      console.log('[VideoStream] Hume TTS disabled (no HUME_API_KEY)');
    }

    // Initialize appearance tracking service
    try {
      const storageService = new PostgresService({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'niimi_db',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || ''
      });

      const visionService = new VisionService(config.openaiApiKey);

      this.appearanceService = new AppearanceService(
        visionService,
        storageService,
        config.openaiApiKey
      );
      console.log('[VideoStream] Appearance tracking service initialized');
    } catch (error) {
      console.warn('[VideoStream] Failed to initialize appearance service:', error);
    }

    this.setupHandlers();
    this.setupEventBusListeners();
  }

  /**
   * Setup EventBus listeners for Motor/Chrono/Logic events
   */
  private setupEventBusListeners(): void {
    const eventBus = EventBus.getInstance();
    console.log('[VideoStream] Setting up EventBus listeners...');

    // Listen for content_ready events from Motor agent
    eventBus.onContentReady((data) => {
      console.log('[VideoStream] Content ready event received, broadcasting to all clients:', data.actionId);
      this.io.emit('content-ready', data);
    });
    console.log('[VideoStream] content_ready listener registered, count:', eventBus.listenerCount('content_ready'));

    // Listen for file_saved events from Motor agent
    eventBus.onFileSaved((data) => {
      console.log('[VideoStream] File saved event received, broadcasting to all clients:', data.actionId);
      this.io.emit('file-saved', data);
    });
    console.log('[VideoStream] file_saved listener registered, count:', eventBus.listenerCount('file_saved'));

    // Listen for document_ready events from Motor agent
    eventBus.onDocumentReady((data) => {
      console.log('[VideoStream] Document ready event received, broadcasting to all clients:', data.documentId);
      this.io.emit('document-ready', data);
    });
    console.log('[VideoStream] document_ready listener registered, count:', eventBus.listenerCount('document_ready'));

    // Listen for motor_log events from Motor agent (for real-time log display)
    eventBus.onMotorLog((data) => {
      this.io.emit('motor-log', data);
    });
    console.log('[VideoStream] motor_log listener registered, count:', eventBus.listenerCount('motor_log'));

    // Listen for exam_scenario events from ExamPrep agent
    // This broadcasts the scenario to be displayed on screen (separate from spoken response)
    eventBus.on('exam_scenario', (data: { topic: string; scenario: string; timestamp: number }) => {
      console.log('[VideoStream] Exam scenario event received, broadcasting to all clients');
      console.log(`[VideoStream] Topic: ${data.topic}`);
      this.io.emit('exam-scenario', {
        topic: data.topic,
        scenario: data.scenario,
        timestamp: data.timestamp,
      });
    });
    console.log('[VideoStream] exam_scenario listener registered');

    // Listen for ct_assessment events from Logic agent
    // This broadcasts the CT assessment results to frontend console
    eventBus.on('ct_assessment', (data: { sessionId: string; turnNumber: number; scores: any; timestamp: number }) => {
      this.io.emit('ct-assessment', {
        sessionId: data.sessionId,
        turnNumber: data.turnNumber,
        scores: data.scores,
        timestamp: data.timestamp,
      });
    });
    console.log('[VideoStream] ct_assessment listener registered');

    console.log('[VideoStream] All EventBus listeners registered successfully');
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupHandlers(): void {
    this.io.on("connection", async (socket: Socket) => {
      console.log(`[VideoStream] Client connected: ${socket.id}`);

      let assignedSessionId = randomUUID();
      let sessionLanguage = "en";

      if (this.chatService) {
        try {
          const sessionInfo = await this.chatService.startExamSession();
          assignedSessionId = sessionInfo.sessionId;
          sessionLanguage = sessionInfo.language;
        } catch (error) {
          console.error(
            `[VideoStream] Failed to start exam session for socket ${socket.id}:`,
            error
          );
        }
      }

      socket.data.sessionId = assignedSessionId;
      socket.join(assignedSessionId);
      this.sessionAssignments.set(socket.id, assignedSessionId);
      this.sessionStates.set(
        assignedSessionId,
        this.sessionStates.get(assignedSessionId) || { turnCount: 0 }
      );

      socket.emit("session-assigned", {
        sessionId: assignedSessionId,
        language: sessionLanguage,
        timestamp: Date.now(),
      });

      const resolveSessionId = (override?: string) =>
        socket.data.sessionId || override || assignedSessionId;

      // Request initial context (like CLI startup)
      socket.on("request-initial-context", async (data: {
        sessionId?: string;
        voice?: string;
        timestamp: number;
      }) => {
        const sessionId = resolveSessionId(data.sessionId);
        console.log(`[VideoStream] Initial context requested for session ${sessionId}`);

        if (!this.chatService) {
          console.error("[VideoStream] Chat service not initialized");
          socket.emit("processing-error", {
            sessionId,
            error: "Chat service not available",
            timestamp: Date.now(),
          });
          return;
        }

        try {
          // Get initial context (hardcoded cultural preferences question)
          const contextResult = await this.chatService.getInitialContext(sessionId);

          if (!contextResult.success) {
            throw new Error(contextResult.error || "Failed to get initial context");
          }

          // Send initial context as examiner message (text)
          this.io.to(sessionId).emit("examiner-response", {
            message: contextResult.response,
            timestamp: Date.now(),
            isFinalAssessment: false,
          });

          console.log(`[VideoStream] Initial exam context sent to session ${sessionId}`);

          // Synthesize voice for initial context (all examiner messages must be spoken)
          if (this.ttsService && contextResult.response) {
            const selectedVoice = data.voice || 'Ava Song';

            if (selectedVoice !== 'No voice') {
              // Fire-and-forget: Stream audio chunks
              (async () => {
                try {
                  console.log(`[VideoStream] Streaming initial context voice for session ${sessionId}...`);
                  console.log(`[VideoStream] Using voice: ${selectedVoice}`);

                  const streamGenerator = this.ttsService!.synthesizeSpeechStreaming(
                    contextResult.response || '',
                    {
                      voice: selectedVoice,
                      limbicState: undefined, // No limbic state for initial context
                      emotionalContext: undefined
                    }
                  );

                  let chunkCount = 0;
                  for await (const chunk of streamGenerator) {
                    chunkCount++;
                    this.io.to(sessionId).emit("examiner-audio-chunk", {
                      chunk: chunk,
                      isFirst: chunkCount === 1,
                      timestamp: Date.now()
                    });
                  }

                  this.io.to(sessionId).emit("examiner-audio-complete", {
                    timestamp: Date.now()
                  });

                  console.log(`[VideoStream] Initial context voice complete for session ${sessionId} (${chunkCount} chunks)`);
                } catch (ttsError) {
                  console.error(`[VideoStream] Initial context voice synthesis failed:`, ttsError);
                }
              })();
            }
          }
        } catch (error) {
          console.error(
            `[VideoStream] Error getting initial context for session ${sessionId}:`,
            error
          );

          socket.emit("processing-error", {
            sessionId,
            error:
              error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
          });
        }
      });

      // Receive video frame
      socket.on("video-frame", async (data: VideoFrameData) => {
        const sessionId = resolveSessionId(data.sessionId);

        try {
          // Process frame (throttled and deduplicated)
          const analysis = await this.frameProcessor.processFrame(data.frame);

          // Only broadcast if frame was analyzed (not skipped)
          if (analysis) {
            const behavioralCues: BehavioralCuesEvent = {
              timestamp: Date.now(),
              engagement: analysis.engagement,
              confusion: analysis.confusion,
              confidence: analysis.confidence,
              thinking: analysis.thinking,
              cues: analysis.cues,
              emotion: analysis.emotion,
              mood: analysis.mood,
              sentiment: analysis.sentiment,
            };

            // Broadcast behavioral cues back to session
            this.io.to(sessionId).emit("behavioral-cues", behavioralCues);

            // Check confidence threshold before storing video emotional state
            const meetsConfidenceThreshold =
              analysis.emotion.confidence >= MIN_VIDEO_EMOTION_CONFIDENCE &&
              analysis.mood.confidence >= MIN_VIDEO_EMOTION_CONFIDENCE;

            if (meetsConfidenceThreshold) {
              // Store video emotional state for this session
              const sessionState = this.sessionStates.get(sessionId) || {};
              sessionState.videoEmotion = {
                emotion: analysis.emotion,
                mood: analysis.mood,
                sentiment: analysis.sentiment,
                engagement: analysis.engagement,
                confusion: analysis.confusion,
                confidence: analysis.confidence,
                thinking: analysis.thinking,
                cues: analysis.cues,
              };
              sessionState.lastVideoUpdate = Date.now();
              this.sessionStates.set(sessionId, sessionState);

              // Simplified video emotion logging with color
              const cyan = '[36m';
              const reset = '[0m';
              console.log(
                `${cyan}[VideoStream] 🎥 Video Emotions for session ${sessionId}${reset}`
              );
              console.log(`${cyan}  Primary Emotion: ${analysis.emotion.primary} (${Math.round(analysis.emotion.confidence * 100)}%)${reset}`);
              console.log(`${cyan}  Primary Mood: ${analysis.mood.primary} (${Math.round(analysis.mood.confidence * 100)}%)${reset}`);
              console.log(`${cyan}  Sentiment: ${analysis.sentiment.polarity.toUpperCase()} (${analysis.sentiment.score.toFixed(2)})${reset}
`);

              // Check appearance only ONCE per session (first frame with high confidence)
              const now = Date.now();
              const shouldCheckAppearance = !sessionState.lastAppearanceCheck;

              if (shouldCheckAppearance && this.appearanceService) {
                // Mark as checked IMMEDIATELY to prevent other frames from triggering
                sessionState.lastAppearanceCheck = now;
                this.sessionStates.set(sessionId, sessionState);

                // Analyze appearance in background (don't block frame processing)
                this.appearanceService.analyzeAndCompare(data.frame, sessionId)
                  .then((result) => {
                    // Update session state
                    sessionState.lastAppearanceCheck = now;
                    sessionState.appearanceChangeSummary = result.changeSummary;
                    this.sessionStates.set(sessionId, sessionState);

                    // Log appearance analysis
                    const yellow = '[33m';
                    const reset = '[0m';
                    console.log(`${yellow}[VideoStream] 👤 Appearance Analysis for session ${sessionId}${reset}`);
                    console.log(`${yellow}  Description: ${result.appearance.overallDescription}${reset}`);
                    console.log(`${yellow}  Identity Match: ${Math.round(result.identityMatchConfidence * 100)}%${reset}`);

                    if (result.changeSummary) {
                      console.log(`${yellow}  Changes: ${result.changeSummary}${reset}
`);

                      // Emit appearance change event to client
                      this.io.to(sessionId).emit("appearance-change", {
                        timestamp: now,
                        changeSummary: result.changeSummary,
                        appearance: result.appearance,
                        identityMatchConfidence: result.identityMatchConfidence
                      });
                    } else {
                      console.log(`${yellow}  No significant changes detected${reset}
`);
                    }

                    // Warn if identity match is low (possible different person)
                    if (result.identityMatchConfidence < 0.5) {
                      console.warn(`${yellow}[VideoStream] WARNING: Low identity match confidence (${Math.round(result.identityMatchConfidence * 100)}%) - possible different person${reset}`);
                      this.io.to(sessionId).emit("identity-warning", {
                        timestamp: now,
                        confidence: result.identityMatchConfidence,
                        message: "The person in the video may be different from the registered user"
                      });
                    }
                  })
                  .catch((error) => {
                    console.error(`[VideoStream] Appearance analysis failed for session ${sessionId}:`, error);
                  });
              }
            } else {
              // Log when emotions are filtered out due to low confidence
              console.log(
                `[VideoStream] Video emotion confidence too low for session ${sessionId}: ` +
                `emotion=${Math.round(analysis.emotion.confidence * 100)}%, ` +
                `mood=${Math.round(analysis.mood.confidence * 100)}% ` +
                `(threshold=${Math.round(MIN_VIDEO_EMOTION_CONFIDENCE * 100)}%)`
              );
            }
          }
        } catch (error) {
          console.error(
            `[VideoStream] Error processing frame for session ${sessionId}:`,
            error
          );

          // Emit error event to client
          socket.emit(
            "processing-error",
            {
              sessionId,
              error: error instanceof Error ? error.message : "Unknown error",
              timestamp: Date.now(),
            }
          );
        }
      });
      socket.on("user-message", async (data: {
        sessionId: string;
        audio: string;
        timestamp: number;
      }) => {
        const sessionId = resolveSessionId(data.sessionId);
        console.log(`[VideoStream] User message received for session ${sessionId}`);

        if (!this.chatService) {
          console.error("[VideoStream] Chat service not initialized");
          socket.emit("processing-error", {
            sessionId: sessionId,
            error: "Chat service not available",
            timestamp: Date.now(),
          });
          return;
        }

        try {
          // Step 1: Transcribe FIRST (fast - OpenAI Whisper API)
          const transcript = await this.chatService.transcribeAudioQuick(data.audio);

          // Emit transcript IMMEDIATELY for instant UX
          this.io.to(sessionId).emit("transcript", {
            text: transcript,
            timestamp: Date.now(),
          });

          console.log(`[VideoStream] Transcript sent to session ${sessionId}: "${transcript}"`);

          // Step 2: Analyze emotions from audio (Hume AI - analyzes voice characteristics)
          let audioEmotion = null;
          try {
            const emotions = await this.chatService.analyzeAudioEmotionsFromVoice(data.audio);

            // Check confidence threshold before storing audio emotional state
            const meetsConfidenceThreshold =
              emotions.emotion.confidence >= MIN_AUDIO_EMOTION_CONFIDENCE &&
              emotions.mood.confidence >= MIN_AUDIO_EMOTION_CONFIDENCE;

            if (meetsConfidenceThreshold) {
              audioEmotion = emotions;

              // Store audio emotional state for this session
              const sessionState = this.sessionStates.get(sessionId) || {};
              sessionState.audioEmotion = {
                emotion: emotions.emotion,
                mood: emotions.mood,
                sentiment: emotions.sentiment,
                cues: emotions.cues,
              };
              sessionState.lastAudioUpdate = Date.now();
              this.sessionStates.set(sessionId, sessionState);

              // Emit audio emotion analysis
              this.io.to(sessionId).emit("audio-emotions", {
                timestamp: Date.now(),
                emotion: emotions.emotion,
                mood: emotions.mood,
                sentiment: emotions.sentiment,
                cues: emotions.cues,
              });

              // Simplified audio emotion logging with color
              const magenta = '\x1b[35m';
              const reset = '\x1b[0m';
              console.log(
                `${magenta}[VideoStream] 🎤 Audio Emotions (Hume AI) for session ${sessionId}${reset}`
              );
              console.log(`${magenta}  Transcript: "${transcript}"${reset}`);
              console.log(`${magenta}  Primary Emotion: ${emotions.emotion.primary} (${Math.round(emotions.emotion.confidence * 100)}%)${reset}`);
              console.log(`${magenta}  Primary Mood: ${emotions.mood.primary} (${Math.round(emotions.mood.confidence * 100)}%)${reset}`);
              console.log(`${magenta}  Sentiment: ${emotions.sentiment.polarity.toUpperCase()} (${emotions.sentiment.score.toFixed(2)})${reset}\n`);
            } else {
              // Log when emotions are filtered out due to low confidence
              console.log(
                `[VideoStream] Audio emotion confidence too low for session ${sessionId}: ` +
                `emotion=${Math.round(emotions.emotion.confidence * 100)}%, ` +
                `mood=${Math.round(emotions.mood.confidence * 100)}% ` +
                `(threshold=${Math.round(MIN_AUDIO_EMOTION_CONFIDENCE * 100)}%)`
              );
            }
          } catch (emotionError) {
            // Log emotion analysis error but don't show to user (non-critical)
            console.warn(`[VideoStream] Audio emotion analysis failed for session ${sessionId} (continuing without audio emotions):`, emotionError);
            // Continue without emotions (audioEmotion remains null)
          }

          // Step 3: Get latest video emotional state, turn count, topic, and scenario (if available)
          const sessionState = this.sessionStates.get(sessionId) || { turnCount: 0 };
          const videoEmotion = sessionState.videoEmotion || null;
          const currentTurnCount = sessionState.turnCount;
          const currentTopic = sessionState.topic;
          const currentScenario = sessionState.scenario;

          // Step 4: Invoke Vocal AI examiner with transcript AND emotional context
          const emotionalContext = {
            video: videoEmotion,
            audio: audioEmotion,
          };

          const examResult = await this.chatService.invokeVocalAI(
            transcript,
            sessionId,
            emotionalContext,
            currentTurnCount,
            currentTopic,
            currentScenario
          );

          if (!examResult.success) {
            throw new Error(examResult.error || "Vocal AI invocation failed");
          }

          // Update turn count, topic, and scenario from graph result
          if (examResult.turnCount !== undefined) {
            sessionState.turnCount = examResult.turnCount;
          }
          if (examResult.topic) {
            sessionState.topic = examResult.topic;
          }
          if (examResult.scenario) {
            sessionState.scenario = examResult.scenario;
          }
          this.sessionStates.set(sessionId, sessionState);

          // Emit examiner's Socratic question
          this.io.to(sessionId).emit("examiner-response", {
            message: examResult.response,
            timestamp: examResult.timestamp,
            isFinalAssessment: examResult.isFinalAssessment || false,
          });

          console.log(`[VideoStream] Examiner responded to session ${sessionId}`);

          // Synthesize voice if TTS service is available (streaming for lower latency)
          if (this.ttsService && this.chatService) {
            const selectedVoice = (data as any).voice || 'Ava Song';

            // Skip voice synthesis if "No voice" is selected OR if this is the final assessment
            if (selectedVoice !== 'No voice' && examResult.response && !examResult.isFinalAssessment) {
              // Fire-and-forget: Stream audio chunks as they're generated by Hume
              (async () => {
                try {
                  // Convert emotional context to format expected by TTS service
                  const primaryEmotion = audioEmotion?.emotion?.primary || videoEmotion?.emotion?.primary;
                  const emotionConfidence = audioEmotion?.emotion?.confidence || videoEmotion?.emotion?.confidence;

                  console.log(`[VideoStream] Streaming voice synthesis for session ${sessionId}...`);
                  console.log(`[VideoStream] Using voice: ${selectedVoice}`);

                  // Use streaming synthesis - sends chunks as Hume generates them
                  const streamGenerator = this.ttsService!.synthesizeSpeechStreaming(
                    examResult.response || '',
                    {
                      voice: selectedVoice,
                      limbicState: undefined,
                      emotionalContext: {
                        primaryEmotion: primaryEmotion,
                        confidence: emotionConfidence
                      }
                    }
                  );

                  let chunkCount = 0;
                  // Stream audio chunks to client as they arrive from Hume
                  for await (const chunk of streamGenerator) {
                    chunkCount++;
                    // Emit each chunk immediately for lower latency
                    this.io.to(sessionId).emit("examiner-audio-chunk", {
                      chunk: chunk,
                      isFirst: chunkCount === 1,
                      timestamp: Date.now()
                    });
                  }

                  // Signal end of stream
                  this.io.to(sessionId).emit("examiner-audio-complete", {
                    timestamp: Date.now()
                  });

                  console.log(`[VideoStream] Voice synthesis complete for session ${sessionId} (${chunkCount} chunks)`);
                } catch (ttsError) {
                  console.error(`[VideoStream] Voice synthesis failed for session ${sessionId}:`, ttsError);
                  // Don't block response - user still gets text even if voice fails
                }
              })();
            } else {
              if (examResult.isFinalAssessment) {
                console.log(`[VideoStream] Voice synthesis skipped - final assessment is text-only`);
              } else {
                console.log(`[VideoStream] Voice synthesis skipped - user selected "No voice" or empty response`);
              }
            }
          }
        } catch (error) {
          console.error(
            `[VideoStream] Error processing user message for session ${sessionId}:`,
            error
          );

          socket.emit("processing-error", {
            sessionId: sessionId,
            error:
              error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
          });
        }
      });

      // Receive text message
      socket.on("text-message", async (data: {
        sessionId: string;
        text: string;
        voice?: string;
        timestamp: number;
      }) => {
        const sessionId = resolveSessionId(data.sessionId);
        console.log(`[VideoStream] Text message received for session ${sessionId}: "${data.text}"`);

        if (!this.chatService) {
          console.error("[VideoStream] Chat service not initialized");
          socket.emit("processing-error", {
            sessionId: sessionId,
            error: "Chat service not available",
            timestamp: Date.now(),
          });
          return;
        }

        try {
          // Get latest video emotional state, turn count, topic, and scenario (if available)
          const sessionState = this.sessionStates.get(sessionId) || { turnCount: 0 };
          const videoEmotion = sessionState.videoEmotion || null;
          const currentTurnCount = sessionState.turnCount;
          const currentTopic = sessionState.topic;
          const currentScenario = sessionState.scenario;

          // Invoke Vocal AI examiner with text AND emotional context (video only, no audio for text messages)
          const emotionalContext = {
            video: videoEmotion,
            audio: null,
          };

          const examResult = await this.chatService.invokeVocalAI(
            data.text,
            sessionId,
            emotionalContext,
            currentTurnCount,
            currentTopic,
            currentScenario
          );

          if (!examResult.success) {
            throw new Error(examResult.error || "Vocal AI invocation failed");
          }

          // Update turn count, topic, and scenario from graph result
          if (examResult.turnCount !== undefined) {
            sessionState.turnCount = examResult.turnCount;
          }
          if (examResult.topic) {
            sessionState.topic = examResult.topic;
          }
          if (examResult.scenario) {
            sessionState.scenario = examResult.scenario;
          }
          this.sessionStates.set(sessionId, sessionState);

          // Emit examiner's Socratic question
          this.io.to(sessionId).emit("examiner-response", {
            message: examResult.response,
            timestamp: examResult.timestamp,
            isFinalAssessment: examResult.isFinalAssessment || false,
          });

          console.log(`[VideoStream] Examiner responded to text message for session ${sessionId}`);

          // Synthesize voice for text message response (all examiner messages must be spoken)
          if (this.ttsService && examResult.response) {
            const selectedVoice = data.voice || 'Ava Song';

            if (selectedVoice !== 'No voice') {
              // Fire-and-forget: Stream audio chunks
              (async () => {
                try {
                  console.log(`[VideoStream] Streaming voice synthesis for text message session ${sessionId}...`);
                  console.log(`[VideoStream] Using voice: ${selectedVoice}`);

                  const streamGenerator = this.ttsService!.synthesizeSpeechStreaming(
                    examResult.response || '',
                    {
                      voice: selectedVoice,
                      limbicState: undefined,
                      emotionalContext: videoEmotion ? {
                        primaryEmotion: videoEmotion.emotion?.primary,
                        confidence: videoEmotion.emotion?.confidence
                      } : undefined
                    }
                  );

                  let chunkCount = 0;
                  for await (const chunk of streamGenerator) {
                    chunkCount++;
                    this.io.to(sessionId).emit("examiner-audio-chunk", {
                      chunk: chunk,
                      isFirst: chunkCount === 1,
                      timestamp: Date.now()
                    });
                  }

                  this.io.to(sessionId).emit("examiner-audio-complete", {
                    timestamp: Date.now()
                  });

                  console.log(`[VideoStream] Voice synthesis complete for text message session ${sessionId} (${chunkCount} chunks)`);
                } catch (ttsError) {
                  console.error(`[VideoStream] Voice synthesis failed for text message session ${sessionId}:`, ttsError);
                }
              })();
            } else {
              console.log(`[VideoStream] Voice synthesis skipped for text message - user selected "No voice"`);
            }
          }
        } catch (error) {
          console.error(
            `[VideoStream] Error processing text message for session ${sessionId}:`,
            error
          );

          socket.emit("processing-error", {
            sessionId: sessionId,
            error:
              error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
          });
        }
      });

      // Client disconnection
      socket.on("disconnect", () => {
        console.log(`[VideoStream] Client disconnected: ${socket.id}`);
      });

      // Handle errors
      socket.on("error", (error) => {
        console.error(`[VideoStream] Socket error for ${socket.id}:`, error);
      });
    });
  }

  /**
   * Start the WebSocket server
   */
  start(): void {
    this.httpServer.listen(this.port, () => {
      console.log(
        `[VideoStream] WebSocket server running on port ${this.port}`
      );
      console.log(`[VideoStream] Ready to receive video frames`);
    });
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    this.io.close();
    this.httpServer.close();
    console.log(`[VideoStream] Server stopped`);
  }

  /**
   * Get server statistics
   */
  getStats(): {
    connectedClients: number;
    frameProcessingStats: {
      totalFrames: number;
      analyzedFrames: number;
      analysisRate: number;
    };
  } {
    return {
      connectedClients: this.io.engine.clientsCount,
      frameProcessingStats: this.frameProcessor.getStats(),
    };
  }

  /**
   * Reset frame processor (useful for testing)
   */
  resetProcessor(): void {
    this.frameProcessor.reset();
  }
}
