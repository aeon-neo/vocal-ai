import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Date Calculation Tools
 *
 * Provides accurate date calculations to prevent Claude from doing mental math
 */

/**
 * Calculate the next occurrence of a specific day of week
 */
export function createCalculateNextDayTool() {
  return tool(
    async ({ dayOfWeek, weeksFromNow }) => {
      try {
        const today = new Date();
        const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
          .indexOf(dayOfWeek.toLowerCase());

        if (targetDay === -1) {
          return JSON.stringify({
            success: false,
            error: `Invalid day of week: ${dayOfWeek}`
          });
        }

        const currentDay = today.getDay();

        // Calculate days until next occurrence
        let daysUntil = targetDay - currentDay;

        // If asking for "next week", add 7 days
        if (weeksFromNow && weeksFromNow > 0) {
          daysUntil += (7 * weeksFromNow);
        } else if (daysUntil <= 0) {
          // If day has passed this week or is today, go to next week
          daysUntil += 7;
        }

        const resultDate = new Date(today);
        resultDate.setDate(today.getDate() + daysUntil);

        return JSON.stringify({
          success: true,
          requestedDay: dayOfWeek,
          weeksFromNow: weeksFromNow || 0,
          calculationSteps: [
            `Today is ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
            `Looking for next ${dayOfWeek}`,
            weeksFromNow ? `Starting ${weeksFromNow} week(s) from now` : 'Starting this week or next',
            `Days to add: ${daysUntil}`,
          ],
          result: {
            date: resultDate.toISOString().split('T')[0],
            dayOfWeek: resultDate.toLocaleDateString('en-US', { weekday: 'long' }),
            formatted: resultDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            timestamp: resultDate.toISOString(),
          }
        }, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to calculate next day",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: "calculate_next_day",
      description: `Calculate the exact date of the next occurrence of a specific day of week.

Use this tool whenever you need to calculate "next Tuesday", "next week Wednesday", etc.
DO NOT try to calculate dates in your head - use this tool to get the exact date.

Examples:
- "next Wednesday" → weeksFromNow: 0 (means next occurrence, could be this week or next)
- "next week Wednesday" → weeksFromNow: 1 (means Wednesday of next week)
- "Wednesday in 2 weeks" → weeksFromNow: 2

The tool shows you the calculation steps so you can verify it's correct.`,
      schema: z.object({
        dayOfWeek: z.enum([
          "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
        ]).describe("The day of week to find"),
        weeksFromNow: z.number().nullable().optional().describe("How many weeks in the future (0 = next occurrence, 1 = next week, 2 = week after, etc.)"),
      }),
    }
  );
}
