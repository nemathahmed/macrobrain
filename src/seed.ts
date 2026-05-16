/**
 * Seed gbrain with SF restaurant macro data.
 *
 * Run once: bun src/seed.ts
 * Add your restaurant data to src/data/restaurants/ as markdown files,
 * then run this script to import them.
 */

import { gbrainPut } from "./gbrain.ts";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const SEED_RESTAURANTS: Array<{ slug: string; content: string }> = [
  {
    slug: "concepts/souvla",
    content: `# Souvla

Greek fast-casual, multiple SF locations (Hayes Valley, Castro, Marina, SOMA).

Tags: greek, mediterranean, high-protein, healthy-ish, fast-casual

## Macros (per item, approx)

- Pork wrap: 580 cal | 45g protein | 42g carbs | 22g fat
- Chicken wrap: 520 cal | 48g protein | 40g carbs | 14g fat
- Lamb wrap: 610 cal | 38g protein | 42g carbs | 26g fat
- Large salad (chicken): 380 cal | 42g protein | 18g carbs | 14g fat
- Frozen greek yogurt: 150 cal | 6g protein | 28g carbs | 2g fat

## Best for goals

High protein, moderate carbs. Chicken or lamb wrap + skip the pita = ~40g protein under 400 cal.
The salad bowls are the macro-friendly move for cutting.

## Current deals

Check [[concepts/souvla-deals]] for active promotions.
`,
  },
  {
    slug: "concepts/tartine-manufactory",
    content: `# Tartine Manufactory

Bakery + restaurant, 595 Alabama St, Mission District.

Tags: bakery, brunch, breakfast, higher-carb, splurge

## Macros (per item, approx)

- Country bread (2 slices): 240 cal | 8g protein | 48g carbs | 2g fat
- Morning bun: 420 cal | 6g protein | 58g carbs | 18g fat
- Croque monsieur: 680 cal | 32g protein | 52g carbs | 34g fat

## Best for goals

Splurge / refeed day. High carb. Not the move for cutting.
`,
  },
  {
    slug: "concepts/dumpling-kitchen",
    content: `# Dumpling Kitchen

Chinese dumplings and noodles, 1935 Taraval St, Sunset District.

Tags: chinese, dumplings, noodles, high-protein, affordable

## Macros (per order, approx)

- Pan-fried pork dumplings (10pc): 480 cal | 24g protein | 52g carbs | 18g fat
- Steamed shrimp dumplings (10pc): 340 cal | 22g protein | 42g carbs | 8g fat
- Beef noodle soup: 520 cal | 36g protein | 58g carbs | 14g fat
- Wontons in chili oil (8pc): 360 cal | 18g protein | 34g carbs | 16g fat

## Best for goals

Steamed dumplings are the high-protein low-fat option. Beef noodle soup is solid for a balanced meal.
`,
  },
  {
    slug: "concepts/el-farolito",
    content: `# El Farolito

Mexican taqueria, 2779 Mission St and other locations.

Tags: mexican, tacos, burritos, high-protein, late-night, affordable

## Macros (per item, approx)

- Carne asada burrito: 980 cal | 52g protein | 110g carbs | 28g fat
- Al pastor taco (x2): 360 cal | 22g protein | 40g carbs | 12g fat
- Carnitas quesadilla: 680 cal | 38g protein | 54g carbs | 28g fat

## Best for goals

Al pastor tacos (no rice) are the macro-friendly move: high protein, reasonable calories.
Skip the burrito if cutting — it's a 1000 cal brick.
`,
  },
  {
    slug: "concepts/burma-superstar",
    content: `# Burma Superstar

Burmese restaurant, 309 Clement St, Richmond District.

Tags: burmese, asian, vegetarian-friendly, moderate-protein

## Macros (per serving, approx)

- Tea leaf salad: 280 cal | 10g protein | 28g carbs | 14g fat
- Rainbow salad: 320 cal | 8g protein | 42g carbs | 12g fat
- Coconut chicken noodle: 580 cal | 32g protein | 62g carbs | 16g fat
- Samusa soup: 420 cal | 18g protein | 52g carbs | 14g fat

## Best for goals

Moderate protein, lighter than most. Good for a rest day or diet break day.
Tea leaf salad is a classic SF bucket-list meal.
`,
  },
];

async function seed(): Promise<void> {
  console.log("Seeding gbrain with SF restaurant data...");

  for (const r of SEED_RESTAURANTS) {
    try {
      await gbrainPut(r.slug, r.content);
      console.log(`  ✓ ${r.slug}`);
    } catch (err) {
      console.error(`  ✗ ${r.slug}:`, err);
    }
  }

  // Also import from src/data/restaurants/ if it exists
  try {
    const dataDir = join(import.meta.dir, "data", "restaurants");
    const files = readdirSync(dataDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = readFileSync(join(dataDir, file), "utf-8");
      const slug = `concepts/${file.replace(".md", "")}`;
      await gbrainPut(slug, content);
      console.log(`  ✓ ${slug} (from file)`);
    }
  } catch {
    // data dir doesn't exist yet, that's fine
  }

  console.log("Seed complete.");
}

await seed();
