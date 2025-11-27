import PQueue from "p-queue";

/**
 * Query Queue Service - Serializes user queries to prevent concurrent Claude API calls
 *
 * Problem: Each query triggers 2 Claude API calls (Tier 2 keyword ranking + response generation).
 * Concurrent users cause rate limit errors.
 *
 * Solution: Queue all requests (FIFO) with concurrency=1 for strict serialization.
 *
 * Usage:
 *   const queue = new QueryQueueService();
 *   const result = await queue.addToQueue(async () => processQuery(...), clientId);
 */

export interface QueueStats {
  size: number;          // Number of pending tasks in queue
  pending: number;       // Number of currently running tasks
  totalPosition: number; // Total queue position (size + pending)
}

export interface QueuedTaskResult<T> {
  position: number;       // Position in queue when added
  estimatedWaitMs: number; // Estimated wait time in milliseconds
  result: T;              // Actual result from the task
}

export class QueryQueueService {
  private queue: PQueue;
  private readonly avgTaskDurationMs: number;

  /**
   * Create a new query queue service
   *
   * @param concurrency - Number of tasks to run concurrently (default: 1 for strict serialization)
   * @param avgTaskDurationMs - Average task duration for wait time estimation (default: 8000ms)
   */
  constructor(concurrency = 1, avgTaskDurationMs = 8000) {
    this.queue = new PQueue({
      concurrency,
      autoStart: true,
    });
    this.avgTaskDurationMs = avgTaskDurationMs;
  }

  /**
   * Add a task to the queue
   *
   * @param task - Async function to execute
   * @param clientId - Client identifier (for logging/tracking)
   * @returns Queue position, estimated wait time, and task result
   */
  async addToQueue<T>(
    task: () => Promise<T>,
    clientId: string
  ): Promise<QueuedTaskResult<T>> {
    // Calculate queue position BEFORE adding task
    const stats = this.getQueueStats();
    const position = stats.totalPosition;
    const estimatedWaitMs = position * this.avgTaskDurationMs;

    if (position > 0) {
      console.log(
        `[Queue] Client ${clientId} added at position ${position + 1}, estimated wait: ${Math.round(estimatedWaitMs / 1000)}s`
      );
    }

    // Add task to queue
    const result = await this.queue.add(task);

    return {
      position: position + 1, // Convert to 1-indexed for user display
      estimatedWaitMs,
      result,
    };
  }

  /**
   * Get current queue statistics
   */
  getQueueStats(): QueueStats {
    return {
      size: this.queue.size,       // Pending tasks
      pending: this.queue.pending, // Currently running
      totalPosition: this.queue.size + this.queue.pending,
    };
  }

  /**
   * Clear the queue (useful for testing or emergency shutdown)
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Wait for all tasks to complete (useful for graceful shutdown)
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }
}
