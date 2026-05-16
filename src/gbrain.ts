import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { supabase } from "./db.ts";

const RESTAURANTS_DIR = join(import.meta.dir, "../../outputs/restaurants");
const DISHES_DIR = join(import.meta.dir, "../../outputs/dishes");

interface Doc {
  slug: string;
  content: string;
  name: string;
  type: "restaurant" | "dish";
  cuisine: string[];
  proteinG?: number;
  caloriesG?: number;
  dietaryTags: string[];
}

// In-memory cache for deals (backed by Supabase)
const dealCache = new Map<string, string>();

let _docs: Doc[] | null = null;

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) {
      const val = rest.join(":").trim().replace(/^["']|["']$/g, "");
      fm[key.trim()] = val;
    }
  }
  return fm;
}

function parseCuisine(content: string): string[] {
  const m = content.match(/^cuisine:\s*\[(.+?)\]/m);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/["']/g, "").toLowerCase());
}

function parseDietaryTags(content: string): string[] {
  const m = content.match(/^dietary_tags:\s*\[(.+?)\]/m) ??
             content.match(/^dietary_focus:\s*\[(.+?)\]/m);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/["']/g, "").toLowerCase());
}

function parseNumber(content: string, key: string): number | undefined {
  const m = content.match(new RegExp(`^\\s*${key}:\\s*(\\d+(?:\\.\\d+)?)`, "m"));
  return m ? parseFloat(m[1]) : undefined;
}

function loadDocs(): Doc[] {
  if (_docs) return _docs;
  const docs: Doc[] = [];

  if (existsSync(RESTAURANTS_DIR)) {
    for (const file of readdirSync(RESTAURANTS_DIR)) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(".md", "");
      const content = readFileSync(join(RESTAURANTS_DIR, file), "utf-8");
      const fm = parseFrontmatter(content);
      docs.push({
        slug: `concepts/${slug}`,
        content,
        name: String(fm["name"] ?? slug),
        type: "restaurant",
        cuisine: parseCuisine(content),
        dietaryTags: parseDietaryTags(content),
      });
    }
  }

  if (existsSync(DISHES_DIR)) {
    for (const file of readdirSync(DISHES_DIR)) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(".md", "");
      const content = readFileSync(join(DISHES_DIR, file), "utf-8");
      const fm = parseFrontmatter(content);
      docs.push({
        slug,
        content,
        name: String(fm["name"] ?? slug),
        type: "dish",
        cuisine: parseCuisine(content),
        proteinG: parseNumber(content, "protein_g"),
        caloriesG: parseNumber(content, "calories"),
        dietaryTags: parseDietaryTags(content),
      });
    }
  }

  _docs = docs;
  console.log(`  ✓ Loaded ${docs.length} restaurant/dish pages into memory`);
  return docs;
}

function termScore(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((s, t) => s + (lower.split(t).length - 1), 0);
}

function proteinBoost(doc: Doc, wantsHighProtein: boolean): number {
  if (!wantsHighProtein || doc.type !== "dish" || !doc.proteinG) return 0;
  if (doc.proteinG >= 40) return 10;
  if (doc.proteinG >= 30) return 6;
  if (doc.proteinG >= 20) return 3;
  return 0;
}

function formatDoc(doc: Doc): string {
  // Return a concise summary: name, cuisine, macros if dish, first 300 chars of body
  const lines: string[] = [`## ${doc.name}`];
  lines.push(`slug: ${doc.slug}`);
  if (doc.cuisine.length) lines.push(`cuisine: ${doc.cuisine.join(", ")}`);
  if (doc.type === "dish" && doc.proteinG != null) {
    lines.push(`macros: ${doc.proteinG}g protein${doc.caloriesG ? `, ${doc.caloriesG} kcal` : ""}`);
  }
  if (doc.dietaryTags.length) lines.push(`dietary: ${doc.dietaryTags.join(", ")}`);

  // Include deal updates from cache if any
  const dealKey = `concepts/${doc.slug.replace(/^concepts\//, "")}`;
  if (dealCache.has(dealKey)) {
    const deal = dealCache.get(dealKey)!;
    const dealSection = deal.match(/## (?:Business Update|Deals & Specials)[\s\S]*?(?=\n## |$)/)?.[0] ?? "";
    if (dealSection) lines.push(dealSection.trim());
  }

  // Body snippet
  const bodyStart = doc.content.indexOf("\n# ");
  if (bodyStart !== -1) {
    lines.push(doc.content.substring(bodyStart, bodyStart + 400).trim());
  }

  return lines.join("\n");
}

export async function gbrainSearch(query: string): Promise<string> {
  const docs = loadDocs();
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const wantsHighProtein = /protein|macro|lean|high.prot/i.test(query);

  const scored = docs
    .map((doc) => ({
      doc,
      score: termScore(doc.content, terms) + proteinBoost(doc, wantsHighProtein),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (scored.length === 0) return "No results found for: " + query;
  return scored.map((r) => formatDoc(r.doc)).join("\n\n---\n\n");
}

export async function gbrainQuery(question: string): Promise<string> {
  return gbrainSearch(question);
}

export async function gbrainGet(slug: string): Promise<string> {
  // Check memory cache first
  if (dealCache.has(slug)) return dealCache.get(slug)!;

  // Check Supabase deals table
  const { data } = await supabase.from("deals").select("content").eq("slug", slug).single();
  if (data?.content) {
    dealCache.set(slug, data.content);
    return data.content;
  }

  // Fall back to static markdown files
  const restaurantSlug = slug.replace(/^concepts\//, "");
  const restaurantPath = join(RESTAURANTS_DIR, `${restaurantSlug}.md`);
  if (existsSync(restaurantPath)) return readFileSync(restaurantPath, "utf-8");

  const dishPath = join(DISHES_DIR, `${slug}.md`);
  if (existsSync(dishPath)) return readFileSync(dishPath, "utf-8");

  return "";
}

export async function gbrainPut(slug: string, content: string): Promise<string> {
  dealCache.set(slug, content);
  await supabase.from("deals").upsert({ slug, content, updated_at: new Date().toISOString() }, { onConflict: "slug" });
  return "ok";
}

export async function gbrainList(type?: string): Promise<string> {
  const docs = loadDocs();
  const filtered = type ? docs.filter((d) => d.type === type) : docs;
  return filtered.map((d) => d.slug).join("\n");
}
