/**
 * Utility functions for date/time formatting and context
 */

export interface DateTimeContext {
  currentDateTime: string; // ISO 8601 format
  dayOfWeek: string; // e.g., "Wednesday"
  dateStr: string; // e.g., "November 13, 2025"
  timestamp: number; // Unix timestamp in milliseconds
}

/**
 * Get current date/time context for agent temporal reasoning
 *
 * Returns formatted date/time information that agents can use to understand
 * temporal references like "next Thursday", "tomorrow", "next week", etc.
 */
export function getCurrentDateTimeContext(): DateTimeContext {
  const now = new Date();

  return {
    currentDateTime: now.toISOString(),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    dateStr: now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    timestamp: now.getTime(),
  };
}

/**
 * Format DateTimeContext for agent system prompts
 */
export function formatDateTimeContextForPrompt(context: DateTimeContext): string {
  return `CURRENT DATE/TIME CONTEXT:
- Current datetime: ${context.currentDateTime}
- Today is: ${context.dayOfWeek}, ${context.dateStr}

Use this to understand temporal references like "next Thursday", "tomorrow", "next week", etc.
British phrases: "week on Monday" or "Monday week" = one week from the coming Monday.`;
}
