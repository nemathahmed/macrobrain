import OpenAI from "openai";
import { gbrainSearch, gbrainQuery, gbrainGet } from "./gbrain.ts";
import type { UserProfile } from "./user.ts";
import { appendHistory, updateGoals } from "./user.ts";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const MODEL = process.env.MODEL ?? "anthropic/claude-opus-4-7";

const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_brain",
      description: "Keyword search gbrain for restaurants, dishes, deals, or macro/nutrition data. Use for specific terms like a cuisine type, restaurant name, or ingredient.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search keywords" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_brain",
      description: "Semantic query gbrain for food recommendations. Use for natural language questions like 'high protein Greek food'.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "Natural language question" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_page",
      description: "Get a specific gbrain page by slug for full details on a restaurant or dish.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: "Page slug e.g. concepts/souvla-hayes-valley" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_user_goals",
      description: "Update the user's dietary goals or preferences. Use when they mention macros, diet, or health goals.",
      parameters: {
        type: "object",
        properties: {
          goals: { type: "string", description: "Goals text to store" },
        },
        required: ["goals"],
      },
    },
  },
];

function makeCallTool(phone: string) {
  return async function callTool(name: string, input: Record<string, string>): Promise<string> {
    try {
      switch (name) {
        case "search_brain":
          return await gbrainSearch(input["query"] ?? "");
        case "query_brain":
          return await gbrainQuery(input["question"] ?? "");
        case "get_page":
          return await gbrainGet(input["slug"] ?? "");
        case "update_user_goals":
          await updateGoals(phone, input["goals"] ?? "");
          return "Goals updated.";
        default:
          return "Unknown tool";
      }
    } catch (err) {
      return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

const SYSTEM = `You are macrobrain, an SMS food assistant for San Francisco. You know SF restaurants, trending deals, and food macros. You help people eat well given their dietary goals.

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
    user.history.length > 0 ? `Recent: ${user.history.slice(-3).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: userContext ? `${text}\n\n[My profile:\n${userContext}]` : text,
    },
  ];

  const callTool = makeCallTool(phone);

  let response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    tools: TOOLS,
    messages,
  });

  // Agentic loop
  while (response.choices[0]?.finish_reason === "tool_calls") {
    const msg = response.choices[0].message;
    messages.push(msg);

    const results: OpenAI.ChatCompletionToolMessageParam[] = await Promise.all(
      (msg.tool_calls ?? []).map(async (tc) => {
        const fn = "function" in tc ? tc.function : null;
        const input = JSON.parse(fn?.arguments ?? "{}") as Record<string, string>;
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: await callTool(fn?.name ?? "", input),
        };
      })
    );

    messages.push(...results);

    response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    });
  }

  const reply = response.choices[0]?.message.content ?? "No answer — try again.";

  appendHistory(phone, text, reply).catch(() => {});

  return reply;
}
