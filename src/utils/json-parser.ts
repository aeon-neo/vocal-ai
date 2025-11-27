/**
 * Parse JSON from LLM responses that may include markdown code fences or explanatory text
 *
 * LLMs often return responses like:
 * - "I understand. Here's the JSON: ```json { "key": "value" } ```"
 * - "```json\n{ "key": "value" }\n```"
 * - Just the JSON: "{ "key": "value" }"
 * - Just explanatory text: "I understand." (returns empty object)
 *
 * This function extracts and parses the JSON safely.
 */
export function parseJsonFromLLM(text: string): any {
  let cleaned = text.trim();

  // Try to find JSON object or array pattern
  // Look for opening brace/bracket (find the FIRST one, not LAST)
  const braceIndex = cleaned.indexOf('{');
  const bracketIndex = cleaned.indexOf('[');

  let jsonStart = -1;
  if (braceIndex !== -1 && bracketIndex !== -1) {
    jsonStart = Math.min(braceIndex, bracketIndex);
  } else if (braceIndex !== -1) {
    jsonStart = braceIndex;
  } else if (bracketIndex !== -1) {
    jsonStart = bracketIndex;
  }

  // If no JSON found, return empty object
  if (jsonStart === -1) {
    // Only log if it's not a known refusal pattern
    if (!text.includes("I do not feel comfortable") && !text.includes("I cannot")) {
      console.warn("No JSON found in LLM response:", text.substring(0, 1000));
    }
    return {};
  }

  // Extract from first { or [ to end
  cleaned = cleaned.substring(jsonStart);

  // Find matching closing brace/bracket
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let jsonEnd = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }

  if (jsonEnd !== -1) {
    cleaned = cleaned.substring(0, jsonEnd);
  }

  // Trim whitespace
  cleaned = cleaned.trim();

  // Remove comments (Claude sometimes adds // comments or /* */ comments to JSON)
  // Remove single-line comments (// ...)
  cleaned = cleaned.split('\n').filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//');
  }).join('\n');

  // Remove multi-line comments (/* ... */)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

  // Fix common JSON issues before parsing
  // Replace unescaped newlines and control characters within string values
  // This regex finds string values and escapes control characters within them
  cleaned = cleaned.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
    // Escape unescaped newlines, tabs, and other control characters
    return match
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\x00-\x1F\x7F]/g, ''); // Remove other control characters
  });

  // Parse JSON
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Log the full JSON to help debug parsing errors
    console.error("Failed to parse JSON after extraction:");
    console.error("Full JSON:", cleaned);
    console.error("JSON length:", cleaned.length, "characters");
    throw error;
  }
}
