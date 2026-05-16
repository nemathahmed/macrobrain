import OpenAI from "openai";
import { supabase } from "./db.ts";
import { gbrainGet, gbrainPut } from "./gbrain.ts";
import { loadRestaurants, buildPhoneIndex } from "./restaurants.ts";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const MODEL = process.env.MODEL ?? "anthropic/claude-opus-4-7";

let _phoneIndex: Map<string, { slug: string; name: string }> | null = null;

export function getBusinessPhoneIndex(): Map<string, { slug: string; name: string }> {
  if (!_phoneIndex) {
    const restaurants = loadRestaurants();
    _phoneIndex = new Map(
      restaurants.map((r) => [r.phone, { slug: r.slug, name: r.name }])
    );
  }
  return _phoneIndex;
}

export async function seedBusinesses(): Promise<void> {
  const restaurants = loadRestaurants();
  const rows = restaurants
    .filter((r) => r.phone)
    .map((r) => ({ phone: r.phone, restaurant_slug: r.slug, restaurant_name: r.name }));

  await supabase.from("businesses").upsert(rows, { onConflict: "phone", ignoreDuplicates: true });
  console.log(`Seeded ${rows.length} businesses into Supabase`);
}

async function parseDeal(restaurantName: string, text: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `A restaurant called "${restaurantName}" texted this deal: "${text}"

Format it as a clean 1-3 sentence deal description for customers. Include timing/expiry if mentioned. Be specific. No fluff.`,
      },
    ],
  });
  return response.choices[0]?.message.content?.trim() ?? text;
}

export async function handleBusinessText(
  phone: string,
  text: string,
  restaurantInfo: { slug: string; name: string }
): Promise<string> {
  const parsed = await parseDeal(restaurantInfo.name, text);
  const date = new Date().toISOString().slice(0, 10);
  const section = `\n## Business Update (${date})\n\n${parsed}\n`;

  try {
    let existing = await gbrainGet(`concepts/${restaurantInfo.slug}`).catch(() => "");
    // Remove previous business update for today
    existing = existing.replace(
      new RegExp(`\\n## Business Update \\(${date}\\)[\\s\\S]*?(?=\\n## |$)`, "g"),
      ""
    );
    const insertPoint = existing.search(/\n## /);
    const updated =
      insertPoint !== -1
        ? existing.slice(0, insertPoint) + section + existing.slice(insertPoint)
        : existing + section;
    await gbrainPut(`concepts/${restaurantInfo.slug}`, updated);
  } catch (err) {
    console.error(`Failed to update gbrain for ${restaurantInfo.slug}:`, err);
  }

  console.log(`  ✓ Deal from ${restaurantInfo.name}: ${parsed.slice(0, 80)}`);
  return `Got it! Your deal has been added to macrobrain and will be surfaced to hungry SF locals. Text anytime to update it.`;
}
