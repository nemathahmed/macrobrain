/**
 * One-shot outreach: texts all restaurants asking for their current deals.
 *
 * Run:  bun src/outreach.ts
 * Dry run: bun src/outreach.ts --dry-run
 * Limit: bun src/outreach.ts --limit 5
 */

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { loadRestaurants } from "./restaurants.ts";
import { migrate } from "./db.ts";
import { seedBusinesses } from "./business.ts";

const OUTREACH_MSG = (name: string) =>
  `Hi ${name}! This is macrobrain — SF's food discovery app. We help locals find great deals. Text us your current happy hour, specials, or any deals and we'll surface them to hungry people nearby. Reply anytime to update!`;

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : undefined;

async function runOutreach(): Promise<void> {
  console.log(`\n=== macrobrain outreach ${isDryRun ? "(DRY RUN)" : ""} ===\n`);

  await migrate();
  await seedBusinesses();

  const restaurants = loadRestaurants().filter((r) => r.phone);
  const targets = limit ? restaurants.slice(0, limit) : restaurants;
  console.log(`Sending to ${targets.length} restaurants...\n`);

  if (isDryRun) {
    for (const r of targets) {
      console.log(`  [DRY] ${r.name} (${r.phone}): ${OUTREACH_MSG(r.name).slice(0, 60)}...`);
    }
    return;
  }

  const app = await Spectrum({
    projectId: process.env.PHOTON_PROJECT_ID!,
    projectSecret: process.env.PHOTON_SECRET_KEY!,
    providers: [imessage.config()],
  });

  let sent = 0;
  let failed = 0;

  for (const r of targets) {
    try {
      const space = await app.space({ users: [r.phone] });
      await space.send(OUTREACH_MSG(r.name));
      console.log(`  ✓ ${r.name} (${r.phone})`);
      sent++;
      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`  ✗ ${r.name}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  await app.stop();

  console.log(`\nDone: ${sent} sent, ${failed} failed`);
}

await runOutreach();
