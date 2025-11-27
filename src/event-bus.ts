import { EventEmitter } from 'events';

/**
 * Event Bus - Shared event emitter for cross-component communication
 *
 * Enables proactive notifications from background processes (Motor agent)
 * to user-facing components (CLI).
 *
 * Pattern: Singleton (shared instance across all modules)
 */

export interface DocumentReadyEvent {
  documentId: number;
  fileName: string;
  collectionId: string;
  collectionName: string;
  chunkCount: number;
  processingTimeMs: number;
}

export interface DocumentErrorEvent {
  fileName: string;
  error: string;
  actionId: number;
}

export interface ContentReadyEvent {
  actionId: number;
  contentType: string;
  purpose: string;
  content: string;
  wordCount: number;
  processingTimeMs: number;
}

export interface FileSavedEvent {
  actionId: number;
  fileName: string;
  filePath: string;
  format: 'markdown' | 'pdf';
  contentType: string;
  purpose: string;
  fileSize: number;
}

export interface MotorLogEvent {
  level: 'info' | 'error' | 'warn';
  message: string;
  actionId?: number;
  actionType?: string;
  timestamp: number;
}

export interface ProgressEvent {
  type: 'tool_call' | 'agent_start' | 'agent_complete';
  tool?: string;
  agent?: string;
  action?: string;
  args?: any;
  timestamp: number;
}

export interface VideoAnalyzedEvent {
  actionId: number;
  fileName: string;
  frameCount: number;
  duration: number;
  analysis: string;
}

export interface AudioAnalyzedEvent {
  actionId: number;
  fileName: string;
  duration: number;
  language: string;
  transcript: string;
  analysis: string;
}

export interface AudioTranscribedEvent {
  actionId: number;
  fileName: string;
  duration: number;
  language: string;
  transcript: string;
}

export interface ActionFailedEvent {
  actionId: number;
  actionType: string;
  error: string;
  payload: any;
  retryCount: number;
}

export class EventBus extends EventEmitter {
  private static instance: EventBus;

  // In-memory Motor log buffer (ephemeral - cleared on restart)
  private motorLogBuffer: MotorLogEvent[] = [];
  private readonly MAX_LOG_ENTRIES = 500;

  private constructor() {
    super();
    // Increase max listeners to avoid warnings in dev
    this.setMaxListeners(20);
    console.log('[EventBus] Singleton instance created');
  }

  /**
   * Get singleton instance of EventBus
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      console.log('[EventBus] Creating new singleton instance');
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Emit document ready event (from Motor agent)
   */
  emitDocumentReady(data: DocumentReadyEvent): void {
    console.log('[DEBUG] EventBus.emitDocumentReady called, listener count:', this.listenerCount('document_ready'));
    this.emit('document_ready', data);
    console.log('[DEBUG] EventBus.emitDocumentReady completed');
  }

  /**
   * Subscribe to document ready events (CLI)
   */
  onDocumentReady(handler: (data: DocumentReadyEvent) => void): void {
    console.log('[DEBUG] EventBus.onDocumentReady - subscribing to document_ready events');
    this.on('document_ready', handler);
    console.log('[DEBUG] EventBus.onDocumentReady - subscribed, listener count:', this.listenerCount('document_ready'));
  }

  /**
   * Emit document error event (from Motor agent)
   */
  emitDocumentError(data: DocumentErrorEvent): void {
    this.emit('document_error', data);
  }

  /**
   * Subscribe to document error events (CLI)
   */
  onDocumentError(handler: (data: DocumentErrorEvent) => void): void {
    this.on('document_error', handler);
  }

  /**
   * Emit content ready event (from Tempo agent)
   */
  emitContentReady(data: ContentReadyEvent): void {
    console.log('[DEBUG] EventBus.emitContentReady called, listener count:', this.listenerCount('content_ready'));
    this.emit('content_ready', data);
    console.log('[DEBUG] EventBus.emitContentReady completed');
  }

  /**
   * Subscribe to content ready events (CLI)
   */
  onContentReady(handler: (data: ContentReadyEvent) => void): void {
    this.on('content_ready', handler);
  }

  /**
   * Emit file saved event (from Motor agent)
   */
  emitFileSaved(data: FileSavedEvent): void {
    console.log('[DEBUG] EventBus.emitFileSaved called, listener count:', this.listenerCount('file_saved'));
    this.emit('file_saved', data);
    console.log('[DEBUG] EventBus.emitFileSaved completed');
  }

  /**
   * Subscribe to file saved events (CLI)
   */
  onFileSaved(handler: (data: FileSavedEvent) => void): void {
    this.on('file_saved', handler);
  }

  /**
   * Emit progress event (from agents/graph)
   */
  emitProgress(data: ProgressEvent): void {
    this.emit('progress', data);
  }

  /**
   * Subscribe to progress events (CLI)
   */
  onProgress(handler: (data: ProgressEvent) => void): void {
    this.on('progress', handler);
  }

  /**
   * Emit video analyzed event (from Motor agent)
   */
  emitVideoAnalyzed(data: VideoAnalyzedEvent): void {
    console.log('[DEBUG] EventBus.emitVideoAnalyzed called, listener count:', this.listenerCount('video_analyzed'));
    this.emit('video_analyzed', data);
    console.log('[DEBUG] EventBus.emitVideoAnalyzed completed');
  }

  /**
   * Subscribe to video analyzed events (CLI)
   */
  onVideoAnalyzed(handler: (data: VideoAnalyzedEvent) => void): void {
    this.on('video_analyzed', handler);
  }

  /**
   * Emit audio analyzed event (from Motor agent)
   */
  emitAudioAnalyzed(data: AudioAnalyzedEvent): void {
    console.log('[DEBUG] EventBus.emitAudioAnalyzed called, listener count:', this.listenerCount('audio_analyzed'));
    this.emit('audio_analyzed', data);
    console.log('[DEBUG] EventBus.emitAudioAnalyzed completed');
  }

  /**
   * Subscribe to audio analyzed events (CLI)
   */
  onAudioAnalyzed(handler: (data: AudioAnalyzedEvent) => void): void {
    this.on('audio_analyzed', handler);
  }

  /**
   * Emit audio transcribed event (from Motor agent)
   */
  emitAudioTranscribed(data: AudioTranscribedEvent): void {
    console.log('[DEBUG] EventBus.emitAudioTranscribed called, listener count:', this.listenerCount('audio_transcribed'));
    this.emit('audio_transcribed', data);
    console.log('[DEBUG] EventBus.emitAudioTranscribed completed');
  }

  /**
   * Subscribe to audio transcribed events (CLI)
   */
  onAudioTranscribed(handler: (data: AudioTranscribedEvent) => void): void {
    this.on('audio_transcribed', handler);
  }

  /**
   * Emit motor log event (from Motor agent)
   * Also stores in ephemeral buffer for Cortex to query
   */
  emitMotorLog(data: MotorLogEvent): void {
    // Store in buffer (capped at MAX_LOG_ENTRIES)
    this.motorLogBuffer.push(data);
    if (this.motorLogBuffer.length > this.MAX_LOG_ENTRIES) {
      this.motorLogBuffer.shift();
    }
    this.emit('motor_log', data);
  }

  /**
   * Subscribe to motor log events (Video Chat)
   */
  onMotorLog(handler: (data: MotorLogEvent) => void): void {
    this.on('motor_log', handler);
  }

  /**
   * Get recent Motor logs (for Cortex tool)
   * Returns logs from the last N minutes
   */
  getRecentMotorLogs(sinceMinutes: number = 10): MotorLogEvent[] {
    const cutoff = Date.now() - (sinceMinutes * 60 * 1000);
    return this.motorLogBuffer.filter(log => log.timestamp >= cutoff);
  }

  /**
   * Clear Motor log buffer (called on session start)
   */
  clearMotorLogs(): void {
    this.motorLogBuffer = [];
    console.log('[EventBus] Motor log buffer cleared');
  }

  /**
   * Emit action failed event (from Motor agent)
   */
  emitActionFailed(data: ActionFailedEvent): void {
    console.log('[DEBUG] EventBus.emitActionFailed called, listener count:', this.listenerCount('action_failed'));
    this.emit('action_failed', data);
    console.log('[DEBUG] EventBus.emitActionFailed completed');
  }

  /**
   * Subscribe to action failed events (CLI)
   */
  onActionFailed(handler: (data: ActionFailedEvent) => void): void {
    this.on('action_failed', handler);
  }

  /**
   * Unsubscribe from all events (cleanup)
   */
  removeAllSubscribers(): void {
    this.removeAllListeners();
  }
}
