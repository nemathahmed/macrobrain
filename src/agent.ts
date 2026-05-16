import Anthropic from "@anthropic-ai/sdk";
import { gbrainSearch, gbrainQuery, gbrainGet, gbrainPut } from "./gbrain.ts";
import type { UserProfile } from "./user.ts";
import { appendHistory } from "./user.ts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_brain",
    description: "Keyword search gbrain for restaurants, dishes, deals, or macro/nutrition data. Use for specific terms like a cuisine type, restaurant name, or ingredient.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Search keywords" } },
      required: ["query"],
    },
  },
  {
    name: "query_brain",
    description: "Semantic query gbrain for food recommendations, deals, or nutrition info. Use for natural language questions like 'high protein Indian food near downtown SF'.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string", description: "Natural language question" } },
      required: ["question"],
    },
  },
  {
    name: "get_page",
    description: "Get a specific gbrain page by slug. Use after finding a slug via search to get full details.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string", description: "Page slug e.g. concepts/piyangos or people/14155551234" } },
      required: ["slug"],
    },
  },
  {
    name: "update_user_goals",
    description: "Update the user's dietary goals or preferences in their profile. Use when the user tells you about their macros, diet, or health goals.",
    input_schema: {
      type: "object",
      properties: {
        goals: { type: "string", description: "New goals text to store" },
        phone: { type: "string", description: "User phone number" },
      },
      required: ["goals", "phone"],
    },
  },
];

async function callTool(name: string, input: Record<string, string>): Promise<string> {
  try {
    switch (name) {
      case "search_brain":
        return await gbrainSearch(input["query"] ?? "");
      case "query_brain":
        return await gbrainQuery(input["question"] ?? "");
      case "get_page":
        return await gbrainGet(input["slug"] ?? "");
      case "update_user_goals": {
        const slug = `people/${(input["phone"] ?? "").replace(/\D/g, "")}`;
        const current = await gbrainGet(slug).catch(() => "");
        const updated = current.replace(
          /## Goals\s*\n[\s\S]*?(?=\n##|$)/,
          `## Goals\n\n${input["goals"] ?? ""}\n\n`
        );
        await gbrainPut(slug, updated || `# User\n\n## Goals\n\n${input["goals"] ?? ""}\n`);
        return "Goals updated.";
      }
      default:
        return "Unknown tool";
    }
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const SYSTEM = `You are macrobrain, an SMS food assistant for San Francisco. You know SF restaurants, trending deals (especially from social media), and food macros. You help people eat well given their dietary goals.

When someone asks about food:
1. Search or query gbrain for matching restaurants, deals, and macro data
2. Consider their personal goals and recent food history
3. Give a SHORT, specific answer: restaurant name, what to order, why it fits their goals, and any current deal

Keep replies under 200 words — this is SMS. Be conversational, not listy. No markdown. Use real restaurant names.

If someone tells you their goals (e.g. "I'm trying to eat 180g protein"), update their profile with update_user_goals.`;

export async function answerFoodQuery(
  text: string,
  user: UserProfile,
  phone: string
): Promise<string> {
  const userContext = [
    user.goals && user.goals !== "(not set)" ? `Goals: ${user.goals}` : null,
    user.history.length > 0
      ? `Recent: ${user.history.slice(-3).join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: userContext
        ? `${text}\n\n[My profile:\n${userContext}]`
        : text,
    },
  ];

  let response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: SYSTEM,
    tools: TOOLS,
    messages,
  });

  // Agentic loop
  while (response.stop_reason === "tool_use") {
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: await callTool(tu.name, tu.input as Record<string, string>),
      }))
    );

    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const reply = textBlock?.text ?? "No answer — try again.";

  // async history update, don't await
  appendHistory(phone, text, reply).catch(() => {});

  return reply;
}
