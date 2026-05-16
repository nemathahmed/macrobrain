/**
 * The Hog — daily SF restaurant intelligence pipeline.
 *
 * Scrapes Instagram/TikTok for trending SF food content via The Hog API
 * and writes structured pages to gbrain under concepts/{restaurant-slug}.
 *
 * Run: bun src/hog.ts
 * Cron: 0 6 * * * bun /path/to/macrobrain/src/hog.ts
 */

import { gbrainGet, gbrainPut, gbrainSearch } from "./gbrain.ts";

interface HogPost {
  restaurant: string;
  slug: string;
  platform: "instagram" | "tiktok";
  content: string;
  deal?: string;
  tags: string[];
  scrapedAt: string;
}

// TODO: replace with real Hog API call when available
async function fetchHogPosts(): Promise<HogPost[]> {
  // Placeholder: The Hog API will return daily SF restaurant social posts
  // Example structure for when API is live:
  //
  // const res = await fetch("https://api.thehog.ai/sf/posts?date=today", {
  //   headers: { Authorization: `Bearer ${process.env.HOG_API_KEY}` },
  // });
  // return res.json();

  console.log("The Hog API not yet configured. Using seed data mode.");
  return [];
}

async function upsertRestaurantPage(post: HogPost): Promise<void> {
  const slug = `concepts/${post.slug}`;
  let existing = "";

  try {
    existing = await gbrainGet(slug);
  } catch {
    // new restaurant
  }

  const today = new Date().toISOString().slice(0, 10);
  const newEntry = `\n### ${today} (${post.platform})\n${post.content}${post.deal ? `\n\n**Deal:** ${post.deal}` : ""}\n`;

  let updated: string;
  if (existing) {
    if (existing.includes("## Recent Posts")) {
      updated = existing.replace("## Recent Posts", `## Recent Posts${newEntry}`);
    } else {
      updated = existing + `\n## Recent Posts${newEntry}`;
    }
  } else {
    updated = `# ${post.restaurant}\n\nTags: ${post.tags.join(", ")}\n\n## Recent Posts${newEntry}`;
  }

  await gbrainPut(slug, updated);
  console.log(`Updated: ${slug}`);
}

export async function runHog(): Promise<void> {
  console.log("The Hog running:", new Date().toISOString());
  const posts = await fetchHogPosts();

  if (posts.length === 0) {
    console.log("No posts to process.");
    return;
  }

  for (const post of posts) {
    await upsertRestaurantPage(post);
  }

  console.log(`Processed ${posts.length} posts.`);
}

if (import.meta.main) {
  await runHog();
}
