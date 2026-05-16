/**
 * Daily restaurant intelligence pipeline via The Hog API.
 *
 * Two-tier approach:
 *
 * DISCOVERY (runs once per restaurant, then weekly):
 *   Deep research (capped at 500 credits) — finds Instagram handle,
 *   happy hour schedule, standing deals, events. Writes to
 *   "## Deals & Specials" in gbrain.
 *
 * DAILY (runs every day, cheap):
 *   Instagram posts scraper — gets latest 10 posts for restaurants
 *   with a known handle. Web scraper for website specials page.
 *   Writes to "## Recent Posts" in gbrain.
 *
 * Run:  bun src/hog.ts
 * Cron: 0 6 * * * bun /path/to/macrobrain/src/hog.ts
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { gbrainGet, gbrainPut } from "./gbrain.ts";

const HOG_BASE = "https://developer.thehog.ai";
const ACCESS_KEY = process.env.HOG_ACCESS_KEY!;
const SECRET_KEY = process.env.HOG_SECRET_KEY!;
const RESTAURANTS_DIR = join(import.meta.dir, "..", "..", "outputs", "restaurants");
const BATCH_SIZE = 5;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 600_000;
const DEEP_RESEARCH_MAX_CREDITS = 500;
const INSTAGRAM_MAX_POSTS = 10;

interface Restaurant {
  name: string;
  slug: string;
  website: string;
}

interface DealIntel {
  happy_hour: string | null;
  daily_specials: string[];
  current_deals: string[];
  upcoming_events: string[];
  instagram_handle: string | null;
  instagram_recent_posts: string[];
}

interface InstagramPost {
  caption?: string;
  text?: string;
  timestamp?: string;
}

const HOG_HEADERS = {
  "X-Access-Key": ACCESS_KEY,
  "X-Secret-Key": SECRET_KEY,
  "Content-Type": "application/json",
};

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    happy_hour: {
      type: "string",
      description: "Happy hour details including days, times, and what is discounted. Null if none.",
    },
    daily_specials: {
      type: "array",
      items: { type: "string" },
      description: "Any daily or weekly food specials currently listed.",
    },
    current_deals: {
      type: "array",
      items: { type: "string" },
      description: "Any current promotions, limited-time offers, or discounts.",
    },
    upcoming_events: {
      type: "array",
      items: { type: "string" },
      description: "Any upcoming events such as live music, themed nights, tastings, or pop-ups.",
    },
    instagram_handle: {
      type: "string",
      description: "The restaurant's Instagram handle without @, found from website links.",
    },
    instagram_recent_posts: {
      type: "array",
      items: { type: "string" },
      description: "Summaries of recent Instagram posts mentioning specials, deals, or new dishes.",
    },
  },
};

function parseRestaurants(): Restaurant[] {
  const files = readdirSync(RESTAURANTS_DIR).filter((f) => f.endsWith(".md"));
  const restaurants: Restaurant[] = [];

  for (const file of files) {
    const content = readFileSync(join(RESTAURANTS_DIR, file), "utf-8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const slugMatch = content.match(/^slug:\s*(.+)$/m);
    const websiteMatch = content.match(/^website:\s*(.+)$/m);

    if (nameMatch?.[1] && slugMatch?.[1] && websiteMatch?.[1]) {
      restaurants.push({
        name: nameMatch[1].trim(),
        slug: slugMatch[1].trim(),
        website: websiteMatch[1].trim(),
      });
    }
  }

  return restaurants;
}

async function getStoredHandle(slug: string): Promise<string | null> {
  try {
    const page = await gbrainGet(`concepts/${slug}`);
    // Matches "**Instagram:** @handle" stored by deep research
    const match = page.match(/\*\*Instagram:\*\*\s*@?([\w.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// Generic operation poller — used by both deep research and any async scrapers
async function pollOperation(
  operationId: string,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${HOG_BASE}/api/operations/${operationId}`, {
      headers: HOG_HEADERS,
    });

    if (!res.ok) continue;

    const data = await res.json() as { status: string; result?: Record<string, unknown> };

    if (data.status === "succeeded") return data.result ?? {};
    if (data.status === "failed") return null;
  }

  return null;
}

// --- SCRAPER HELPERS ---

async function scrapeInstagramPosts(handle: string): Promise<string[]> {
  const res = await fetch(`${HOG_BASE}/api/v1/platform/scrapers/instagram/posts`, {
    method: "POST",
    headers: HOG_HEADERS,
    body: JSON.stringify({ username: handle, maxPosts: INSTAGRAM_MAX_POSTS }),
  });

  if (!res.ok) return [];

  const data = await res.json() as { id?: string; posts?: InstagramPost[]; data?: { posts?: InstagramPost[] } };

  let posts: InstagramPost[] = [];

  if (data.id && !data.posts) {
    // Async scraper — poll for result
    const result = await pollOperation(data.id, 60_000);
    if (!result) return [];
    posts = (result["posts"] ?? (result["data"] as Record<string, unknown>)?.["posts"] ?? []) as InstagramPost[];
  } else {
    posts = data.posts ?? data.data?.posts ?? [];
  }

  return posts
    .map((p) => (p.caption ?? p.text ?? "").trim())
    .filter((c) => c.length > 0)
    .map((c) => c.slice(0, 300));
}

async function scrapeWebsite(url: string): Promise<string> {
  const res = await fetch(`${HOG_BASE}/api/v1/platform/scrapers/web/scrape`, {
    method: "POST",
    headers: HOG_HEADERS,
    body: JSON.stringify({ url, renderJs: true }),
  });

  if (!res.ok) return "";

  const data = await res.json() as { id?: string; content?: string; text?: string; data?: { content?: string; text?: string } };

  if (data.id && !data.content && !data.text) {
    const result = await pollOperation(data.id, 60_000);
    if (!result) return "";
    return (result["content"] ?? result["text"] ?? "") as string;
  }

  return data.content ?? data.text ?? data.data?.content ?? data.data?.text ?? "";
}

// --- DEEP RESEARCH (discovery, capped) ---

async function runDeepResearch(restaurant: Restaurant): Promise<DealIntel | null> {
  const res = await fetch(`${HOG_BASE}/api/deep-research`, {
    method: "POST",
    headers: HOG_HEADERS,
    body: JSON.stringify({
      prompt: `Today is ${new Date().toISOString().slice(0, 10)}. Research the restaurant "${restaurant.name}". Find:
1. Current happy hour details (days, times, what is discounted)
2. Daily or weekly food specials
3. Any current promotions or limited-time deals
4. Upcoming events (live music, themed nights, tastings, pop-ups)
5. Their Instagram handle (look for it linked on the website)
6. Any recent Instagram posts about specials, new dishes, or deals

Only include events and deals with future dates or no specific date. Ignore anything that has already passed.`,
      schema: RESEARCH_SCHEMA,
      budget: { maxCredits: DEEP_RESEARCH_MAX_CREDITS },
      urls: [restaurant.website],
    }),
  });

  if (!res.ok) throw new Error(`Hog ${res.status}: ${await res.text()}`);

  const { id } = await res.json() as { id: string };
  const result = await pollOperation(id);
  if (!result) return null;

  const d = (result["data"] ?? result) as DealIntel;
  return {
    happy_hour: d.happy_hour ?? null,
    daily_specials: d.daily_specials ?? [],
    current_deals: d.current_deals ?? [],
    upcoming_events: d.upcoming_events ?? [],
    instagram_handle: d.instagram_handle ?? null,
    instagram_recent_posts: d.instagram_recent_posts ?? [],
  };
}

// --- GBRAIN WRITES ---

function formatDealsSection(intel: DealIntel, date: string): string {
  const lines: string[] = [`\n## Deals & Specials (${date})\n`];

  if (intel.happy_hour) lines.push(`**Happy Hour:** ${intel.happy_hour}\n`);

  if (intel.daily_specials.length > 0) {
    lines.push("**Daily Specials:**");
    intel.daily_specials.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  if (intel.current_deals.length > 0) {
    lines.push("**Current Deals:**");
    intel.current_deals.forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  if (intel.upcoming_events.length > 0) {
    lines.push("**Events:**");
    intel.upcoming_events.forEach((e) => lines.push(`- ${e}`));
    lines.push("");
  }

  if (intel.instagram_handle) lines.push(`**Instagram:** @${intel.instagram_handle}\n`);

  if (intel.instagram_recent_posts.length > 0) {
    lines.push("**Recent Instagram:**");
    intel.instagram_recent_posts.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  }

  const hasContent =
    intel.happy_hour ||
    intel.daily_specials.length > 0 ||
    intel.current_deals.length > 0 ||
    intel.upcoming_events.length > 0 ||
    intel.instagram_recent_posts.length > 0;

  if (!hasContent) lines.push("_No current deals or specials found._\n");

  return lines.join("\n");
}

function formatPostsSection(posts: string[], date: string): string {
  if (posts.length === 0) return "";
  const lines = [`\n## Recent Posts (${date})\n`];
  posts.forEach((p) => lines.push(`- ${p}`));
  lines.push("");
  return lines.join("\n");
}

function formatWebsiteSection(text: string, date: string): string {
  if (!text.trim()) return "";
  // Strip HTML tags, collapse whitespace, trim to 2000 chars
  const clean = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return `\n## Website (${date})\n\n${clean}\n`;
}

function replaceSection(page: string, header: RegExp, newSection: string): string {
  // Remove existing section matching header, then append new one
  const stripped = page.replace(
    new RegExp(`\\n## ${header.source}[\\s\\S]*?(?=\\n## |$)`, "g"),
    ""
  );
  const insertPoint = stripped.search(/\n## /);
  return insertPoint !== -1
    ? stripped.slice(0, insertPoint) + newSection + stripped.slice(insertPoint)
    : stripped + newSection;
}

async function writeDealsToGbrain(restaurant: Restaurant, intel: DealIntel, date: string): Promise<void> {
  const slug = `concepts/${restaurant.slug}`;
  let page = "";
  try {
    page = await gbrainGet(slug);
  } catch {
    page = `# ${restaurant.name}\n\nWebsite: ${restaurant.website}\n`;
  }

  const section = formatDealsSection(intel, date);
  const updated = replaceSection(page, /Deals & Specials \([\d-]+\)/, section);
  await gbrainPut(slug, updated);
}

async function writePostsToGbrain(restaurant: Restaurant, posts: string[], date: string): Promise<void> {
  const slug = `concepts/${restaurant.slug}`;
  let page = "";
  try {
    page = await gbrainGet(slug);
  } catch {
    page = `# ${restaurant.name}\n\nWebsite: ${restaurant.website}\n`;
  }

  const section = formatPostsSection(posts, date);
  if (!section) return;
  const updated = replaceSection(page, /Recent Posts \([\d-]+\)/, section);
  await gbrainPut(slug, updated);
}

async function writeWebsiteToGbrain(restaurant: Restaurant, text: string, date: string): Promise<void> {
  const section = formatWebsiteSection(text, date);
  if (!section) return;

  const slug = `concepts/${restaurant.slug}`;
  let page = "";
  try {
    page = await gbrainGet(slug);
  } catch {
    page = `# ${restaurant.name}\n\nWebsite: ${restaurant.website}\n`;
  }

  const updated = replaceSection(page, /Website \([\d-]+\)/, section);
  await gbrainPut(slug, updated);
}

// --- MAIN PER-RESTAURANT LOGIC ---

async function processRestaurant(restaurant: Restaurant, date: string): Promise<void> {
  const storedHandle = await getStoredHandle(restaurant.slug);

  if (storedHandle) {
    // Cheap daily path: Instagram posts + web scrape
    const [posts, websiteText] = await Promise.all([
      scrapeInstagramPosts(storedHandle),
      scrapeWebsite(restaurant.website),
    ]);

    await Promise.all([
      writePostsToGbrain(restaurant, posts, date),
      writeWebsiteToGbrain(restaurant, websiteText, date),
    ]);

    console.log(
      `  ✓ ${restaurant.name} [scraper @${storedHandle}] — ${posts.length} post(s), website scraped`
    );
  } else {
    // Discovery path: deep research (capped at 500 credits)
    let intel: DealIntel | null;
    try {
      intel = await runDeepResearch(restaurant);
    } catch (err) {
      console.error(`  ✗ ${restaurant.name}: ${err instanceof Error ? err.message : err}`);
      return;
    }

    if (!intel) {
      console.error(`  ✗ ${restaurant.name}: deep research returned no data`);
      return;
    }

    const websiteText = await scrapeWebsite(restaurant.website);
    await Promise.all([
      writeDealsToGbrain(restaurant, intel, date),
      writeWebsiteToGbrain(restaurant, websiteText, date),
    ]);

    const dealCount =
      (intel.happy_hour ? 1 : 0) + intel.daily_specials.length + intel.current_deals.length;
    console.log(
      `  ✓ ${restaurant.name} [deep-research, max ${DEEP_RESEARCH_MAX_CREDITS} credits]` +
      `${dealCount > 0 ? ` — ${dealCount} deal(s)` : ""}` +
      `${intel.instagram_handle ? ` @${intel.instagram_handle}` : " (no handle found)"}`
    );
  }
}

async function processBatch(batch: Restaurant[], date: string): Promise<void> {
  await Promise.all(batch.map((r) => processRestaurant(r, date)));
}

export async function runHog(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n=== The Hog — ${date} ===\n`);

  if (!ACCESS_KEY || !SECRET_KEY) {
    console.error("Missing HOG_ACCESS_KEY or HOG_SECRET_KEY in environment.");
    process.exit(1);
  }

  const restaurants = parseRestaurants();
  console.log(`Restaurants: ${restaurants.length}`);
  console.log(`Batch size:  ${BATCH_SIZE}\n`);

  let done = 0;
  for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
    const batch = restaurants.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(restaurants.length / BATCH_SIZE)}`);
    await processBatch(batch, date);
    done += batch.length;
    console.log(`  ${done}/${restaurants.length} done\n`);
  }

  console.log("=== Done ===");
}

if (import.meta.main) {
  await runHog();
}
