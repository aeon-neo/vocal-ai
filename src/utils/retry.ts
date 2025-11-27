/**
 * Retry Utility with Exponential Backoff
 *
 * Handles transient failures for LLM API calls with:
 * - Exponential backoff (1s, 2s, 4s)
 * - Retry on rate limits (429), network errors, timeouts
 * - No retry on auth errors (401, 403) or bad requests (400)
 */

export interface RetryOptions {
  maxAttempts?: number; // Default: 3
  initialDelayMs?: number; // Default: 1000ms
  maxDelayMs?: number; // Default: 8000ms
  backoffMultiplier?: number; // Default: 2
  retryableStatusCodes?: number[]; // Default: [429, 500, 502, 503, 504]
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly attempt: number,
    public readonly maxAttempts: number,
    public readonly originalError: Error
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 8000,
    backoffMultiplier = 2,
    retryableStatusCodes = [429, 500, 502, 503, 504],
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on final attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Check if error is retryable
      const isRetryable = isRetryableError(error, retryableStatusCodes);

      if (!isRetryable) {
        // Non-retryable error (auth, bad request, etc.) - fail immediately
        throw error;
      }

      // Log retry attempt
      console.warn(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`
      );

      // Wait before next attempt
      await sleep(delay);

      // Calculate next delay with exponential backoff
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  // All attempts exhausted
  throw new RetryableError(
    `Failed after ${maxAttempts} attempts: ${lastError?.message}`,
    maxAttempts,
    maxAttempts,
    lastError!
  );
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(
  error: any,
  retryableStatusCodes: number[]
): boolean {
  // Network errors (ECONNRESET, ETIMEDOUT, etc.)
  if (
    error.code === "ECONNRESET" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ENOTFOUND" ||
    error.code === "ENETUNREACH"
  ) {
    return true;
  }

  // HTTP status code errors
  if (error.status && retryableStatusCodes.includes(error.status)) {
    return true;
  }

  // OpenAI SDK specific errors (server overload)
  if (error.error?.type === "server_error" || error.error?.code === "server_error") {
    return true;
  }

  // Rate limit errors (common pattern)
  if (
    error.message?.toLowerCase().includes("rate limit") ||
    error.message?.toLowerCase().includes("too many requests")
  ) {
    return true;
  }

  // Non-retryable by default
  return false;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
