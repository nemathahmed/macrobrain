import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function extractDeal(content: string): string {
  const m = content.match(/## (?:Business Update|Deals & Specials)([\s\S]*?)(?=\n## |$)/);
  return m ? m[1].trim().replace(/\n+/g, " ").slice(0, 180) : "";
}

function slugToName(slug: string): string {
  return slug
    .replace(/^concepts\//, "")
    .split("-")
    .map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : "")
    .join(" ");
}

export default async function handler(_req: any, res: any) {
  const { data } = await supabase
    .from("deals")
    .select("slug, content, updated_at")
    .order("updated_at", { ascending: false })
    .limit(60);

  const rows = (data ?? []).map((row) => ({
    slug: row.slug,
    name: slugToName(row.slug),
    preview: extractDeal(row.content),
    source: row.content.includes("## Business Update") ? "restaurant" : "hog",
    updated_at: row.updated_at,
  }));

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(rows));
}
