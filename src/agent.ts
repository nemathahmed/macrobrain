import OpenAI from "openai";
import { gbrainSearch, gbrainQuery, gbrainGet } from "./gbrain.ts";
import type { UserProfile } from "./user.ts";
import { appendHistory, updateGoals, updateMemory } from "./user.ts";

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const MODEL = process.env.MODEL ?? "anthropic/claude-sonnet-4-6";

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

async function updateMemoryBackground(
  phone: string,
  userText: string,
  reply: string,
  currentMemory: string
): Promise<void> {
  try {
    const res = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4-5-20251014",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Update these running notes about a food app user based on their latest exchange. Keep under 400 words, plain text.\n\nCurrent notes:\n${currentMemory || "(none)"}\n\nUser: "${userText}"\nBot: "${reply}"\n\nWrite the full updated notes:`,
        },
      ],
    });
    const newMemory = res.choices[0]?.message.content?.trim();
    if (newMemory) await updateMemory(phone, newMemory);
  } catch {
    // non-critical, ignore
  }
}

const SYSTEM = `You are macrobrain, an SMS food assistant for San Francisco. You have a database of SF restaurants, dishes, macros, and deals.

Reply in a single tight SMS message. Format:
[Restaurant] [Neighborhood] — [Dish], [protein]g protein / [cal] cal. [One-line reason]. [Price]. [Street address, SF, CA]

Confirmation rule (HIGHEST PRIORITY):
If the user confirms or selects a restaurant already mentioned — "sounds good", "that one", "let's go", "yeah", "ok", repeating the name — reply with ONLY the street address so they can tap to navigate. Nothing else.

Rules:
- Never mention internal tools, search systems, or your data sources
- Never say "I don't have data on X" — find the closest match and recommend it confidently
- Always end with the street address (e.g. "517 Hayes St, SF, CA") so the user can tap to navigate
- Under 320 characters total
- No filler, no meta-commentary, no clarifying questions unless truly necessary
- Multiple options? Give 2-3 as a tight list
- If someone tells you their goals (e.g. "trying to hit 180g protein"), call update_user_goals

Example:
"Souvla Hayes Valley — Half Rotisserie Chicken, 70g protein / 720 cal. Spit-fired, gluten-free. $19. 517 Hayes St, SF, CA"`;


export async function answerFoodQuery(
  text: string,
  user: UserProfile,
  phone: string
): Promise<string> {
  const userContext = [
    user.memory ? `Notes about this user:\n${user.memory}` : null,
    user.goals && user.goals !== "(not set)" ? `Goals: ${user.goals}` : null,
    user.history.length > 0 ? `Recent conversation:\n${user.history.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

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
    max_tokens: 512,
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
      max_tokens: 512,
      tools: TOOLS,
      messages,
    });
  }

  const raw = response.choices[0]?.message.content ?? "No answer — try again.";
  const reply = stripMarkdown(raw);

  appendHistory(phone, text, reply).catch(() => {});
  updateMemoryBackground(phone, text, reply, user.memory).catch(() => {});

  return reply;
}
