/**
 * Seeds gbrain with all SF restaurant and dish data from outputs/.
 *
 * Run: bun src/seed.ts
 * Re-runnable (upserts). Runs in parallel batches for speed.
 */

import { gbrainPut } from "./gbrain.ts";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, "..", "..", "outputs");
const RESTAURANTS_DIR = join(DATA_DIR, "restaurants");
const DISHES_DIR = join(DATA_DIR, "dishes");
const CONCURRENCY = 1;

async function runBatch(files: string[], dir: string, label: string): Promise<void> {
  let done = 0;
  const total = files.length;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (f) => {
        const slug = `concepts/${f.replace(/\.md$/, "")}`;
        try {
          const content = readFileSync(join(dir, f), "utf-8");
          await gbrainPut(slug, content);
          done++;
        } catch (err) {
          console.error(`\n  ✗ ${slug}:`, err instanceof Error ? err.message : err);
        }
      })
    );
    process.stdout.write(`\r  ${label}: ${done}/${total}`);
  }
  console.log();
}

async function seed(): Promise<void> {
  console.log("=== macrobrain gbrain seed ===\n");

  if (!existsSync(RESTAURANTS_DIR)) {
    console.error(`Restaurants dir not found: ${RESTAURANTS_DIR}`);
    process.exit(1);
  }

  const restaurantFiles = readdirSync(RESTAURANTS_DIR).filter((f) => f.endsWith(".md")).sort();
  console.log(`Seeding ${restaurantFiles.length} restaurants...`);
  await runBatch(restaurantFiles, RESTAURANTS_DIR, "restaurants");

  const dishFiles = readdirSync(DISHES_DIR).filter((f) => f.endsWith(".md")).sort();
  console.log(`\nSeeding ${dishFiles.length} dishes...`);
  await runBatch(dishFiles, DISHES_DIR, "dishes");

  console.log("\n=== Seed complete ===");
  console.log(`  Restaurants: ${restaurantFiles.length}`);
  console.log(`  Dishes:      ${dishFiles.length}`);
  console.log(`  Total:       ${restaurantFiles.length + dishFiles.length} pages in gbrain`);
}

await seed();
