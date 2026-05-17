/**
 * One-time (or re-run) indexer: pushes all restaurant + dish markdown files
 * into Zero Entropy collection "sf-restaurants".
 *
 * Run: bun --env-file=.env src/index-ze.ts
 *
 * Safe to re-run — uses overwrite:true. Will skip if ZE key is missing.
 */

import ZeroEntropy, { ConflictError, HTTPStatusError } from "zeroentropy";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const COLLECTION = "sf-restaurants";
const RESTAURANTS_DIR = join(import.meta.dir, "../../outputs/restaurants");
const DISHES_DIR = join(import.meta.dir, "../../outputs/dishes");
const BATCH = 10; // parallel adds per tick

const client = new ZeroEntropy({ apiKey: process.env.ZEROENTROPY_API_KEY! });

interface FileEntry {
  path: string;
  content: string;
  metadata: Record<string, string>;
}

function parseMeta(content: string, type: "restaurant" | "dish"): Record<string, string> {
  const get = (key: string) => content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
  const cuisine = content.match(/^cuisine:\s*\[(.+?)\]/m)?.[1]
    ?.split(",").map(s => s.trim().replace(/["']/g, "")).join(",") ?? "";
  return {
    type,
    cuisine,
    protein_g: get("protein_g") || get("protein"),
  };
}

function loadFiles(): FileEntry[] {
  const entries: FileEntry[] = [];

  if (existsSync(RESTAURANTS_DIR)) {
    for (const f of readdirSync(RESTAURANTS_DIR).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(join(RESTAURANTS_DIR, f), "utf-8");
      entries.push({
        path: `restaurants/${f.replace(".md", "")}`,
        content,
        metadata: parseMeta(content, "restaurant"),
      });
    }
  }

  if (existsSync(DISHES_DIR)) {
    for (const f of readdirSync(DISHES_DIR).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(join(DISHES_DIR, f), "utf-8");
      entries.push({
        path: `dishes/${f.replace(".md", "")}`,
        content,
        metadata: parseMeta(content, "dish"),
      });
    }
  }

  return entries;
}

async function addDoc(entry: FileEntry): Promise<"ok" | "skip" | "err"> {
  try {
    await client.documents.add({
      collection_name: COLLECTION,
      path: entry.path,
      content: { type: "text", text: entry.content },
      metadata: entry.metadata,
    });
    return "ok";
  } catch (err) {
    if (err instanceof ConflictError) return "skip"; // already indexed
    console.error(`  ✗ ${entry.path}: ${err instanceof Error ? err.message : err}`);
    return "err";
  }
}

async function main() {
  if (!process.env.ZEROENTROPY_API_KEY) {
    console.error("ZEROENTROPY_API_KEY not set — skipping index.");
    process.exit(0);
  }

  // Ensure collection exists
  try {
    await client.collections.add({ collection_name: COLLECTION });
    console.log(`Created collection: ${COLLECTION}`);
  } catch (err) {
    if (err instanceof ConflictError) {
      console.log(`Collection already exists: ${COLLECTION}`);
    } else {
      throw err;
    }
  }

  const files = loadFiles();
  console.log(`\nIndexing ${files.length} files into "${COLLECTION}"...`);

  let ok = 0, skipped = 0, errors = 0;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(addDoc));
    ok += results.filter(r => r === "ok").length;
    skipped += results.filter(r => r === "skip").length;
    errors += results.filter(r => r === "err").length;
    process.stdout.write(`\r  ${i + batch.length}/${files.length} done (${ok} new, ${skipped} skipped, ${errors} errors)`);
  }

  console.log(`\n\nDone. ${ok} new, ${skipped} already indexed, ${errors} errors.`);

  console.log("Documents are being indexed by ZE — queries will work as they complete (~1-2 min).");
}

main().catch(console.error);
