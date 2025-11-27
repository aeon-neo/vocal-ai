/**
 * Test script for LLM providers
 *
 * Tests both Claude and Ollama providers for:
 * 1. Simple text generation
 * 2. Tool calling
 */

import { createLLMProvider, MODEL_MAPPINGS, LLMTool } from "./index";
import { config as dotenvConfig } from "dotenv";

// Load environment variables
dotenvConfig();

async function testSimpleGeneration(
  providerName: "claude" | "ollama",
  modelName: string
) {
  console.log(
    `\n${"=".repeat(60)}\nTesting Simple Generation: ${providerName} (${modelName})\n${"=".repeat(60)}\n`
  );

  const provider = createLLMProvider({ provider: providerName, model: modelName });

  const startTime = Date.now();
  const response = await provider.generate(
    [
      {
        role: "user",
        content: "What is 2+2? Answer in one sentence.",
      },
    ],
    {
      maxTokens: 100,
      temperature: 0,
    }
  );
  const duration = Date.now() - startTime;

  console.log(`Response: ${response.content}`);
  console.log(`Finish reason: ${response.finishReason}`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Tokens/sec (estimated): ${Math.round((response.content.length / 4) / (duration / 1000))}`);
}

async function testToolCalling(
  providerName: "claude" | "ollama",
  modelName: string
) {
  console.log(
    `\n${"=".repeat(60)}\nTesting Tool Calling: ${providerName} (${modelName})\n${"=".repeat(60)}\n`
  );

  const provider = createLLMProvider({ provider: providerName, model: modelName });

  // Define test tools
  const tools: LLMTool[] = [
    {
      name: "get_weather",
      description: "Get current weather for a location",
      input_schema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City name or coordinates",
          },
          units: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "Temperature units",
          },
        },
        required: ["location"],
      },
    },
    {
      name: "calculate",
      description: "Perform mathematical calculations",
      input_schema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Mathematical expression to evaluate",
          },
        },
        required: ["expression"],
      },
    },
  ];

  const startTime = Date.now();
  const response = await provider.generateWithTools(
    [
      {
        role: "user",
        content: "What's the weather in London?",
      },
    ],
    tools,
    {
      maxTokens: 500,
      temperature: 0,
    }
  );
  const duration = Date.now() - startTime;

  console.log(`Response content: ${response.content}`);
  console.log(`Tool calls:`, JSON.stringify(response.toolCalls, null, 2));
  console.log(`Finish reason: ${response.finishReason}`);
  console.log(`Duration: ${duration}ms`);

  // Validate tool call
  if (response.toolCalls && response.toolCalls.length > 0) {
    const toolCall = response.toolCalls[0];
    console.log(`\nValidation:`);
    console.log(`- Tool called: ${toolCall.name}`);
    console.log(`- Expected: get_weather`);
    console.log(`- Match: ${toolCall.name === "get_weather" ? "✓" : "✗"}`);
    console.log(`- Location param: ${toolCall.input.location || "missing"}`);
    console.log(`- Contains "London": ${JSON.stringify(toolCall.input).toLowerCase().includes("london") ? "✓" : "✗"}`);
  } else {
    console.log(`\n⚠️  WARNING: No tool calls detected!`);
  }
}

async function testMultipleTools(
  providerName: "claude" | "ollama",
  modelName: string
) {
  console.log(
    `\n${"=".repeat(60)}\nTesting Multiple Tool Calls: ${providerName} (${modelName})\n${"=".repeat(60)}\n`
  );

  const provider = createLLMProvider({ provider: providerName, model: modelName });

  const tools: LLMTool[] = [
    {
      name: "create_task",
      description: "Create a new task",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          dueDate: { type: "string", description: "Due date (YYYY-MM-DD)" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["title"],
      },
    },
    {
      name: "create_event",
      description: "Create a calendar event",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          startTime: { type: "string", description: "Start time (ISO 8601)" },
          duration: { type: "number", description: "Duration in minutes" },
        },
        required: ["title", "startTime"],
      },
    },
    {
      name: "send_email",
      description: "Send an email",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
      },
    },
  ];

  const startTime = Date.now();
  const response = await provider.generateWithTools(
    [
      {
        role: "user",
        content: "Create a task to 'Review Q4 reports' with high priority, and schedule a meeting titled 'Q4 Review' for tomorrow at 2pm for 60 minutes.",
      },
    ],
    tools,
    {
      maxTokens: 1000,
      temperature: 0,
    }
  );
  const duration = Date.now() - startTime;

  console.log(`Response content: ${response.content}`);
  console.log(`Tool calls:`, JSON.stringify(response.toolCalls, null, 2));
  console.log(`Finish reason: ${response.finishReason}`);
  console.log(`Duration: ${duration}ms`);

  // Validate multiple tool calls
  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log(`\nValidation:`);
    console.log(`- Number of tool calls: ${response.toolCalls.length}`);
    console.log(`- Expected: 2 (create_task + create_event)`);
    console.log(`- Match: ${response.toolCalls.length === 2 ? "✓" : "✗"}`);

    const toolNames = response.toolCalls.map((tc) => tc.name);
    console.log(`- Tools called: ${toolNames.join(", ")}`);
    console.log(`- Has create_task: ${toolNames.includes("create_task") ? "✓" : "✗"}`);
    console.log(`- Has create_event: ${toolNames.includes("create_event") ? "✓" : "✗"}`);
  } else {
    console.log(`\n⚠️  WARNING: No tool calls detected!`);
  }
}

async function main() {
  console.log("LLM Provider Test Suite");
  console.log("========================\n");

  try {
    // Test Claude
    console.log("\n### CLAUDE TESTS ###\n");
    await testSimpleGeneration("claude", MODEL_MAPPINGS.HAIKU_3_5);
    await testToolCalling("claude", MODEL_MAPPINGS.HAIKU_3_5);
    await testMultipleTools("claude", MODEL_MAPPINGS.SONNET_4_5);

    // Test Ollama
    console.log("\n\n### OLLAMA TESTS ###\n");
    await testSimpleGeneration("ollama", MODEL_MAPPINGS.QWEN_7B_Q4);
    await testToolCalling("ollama", MODEL_MAPPINGS.QWEN_7B_Q4);
    await testMultipleTools("ollama", MODEL_MAPPINGS.QWEN_7B_Q4);

    console.log("\n\n" + "=".repeat(60));
    console.log("All tests completed successfully!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
main();
