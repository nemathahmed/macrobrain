import { gbrainGet, gbrainPut } from "./gbrain.ts";

export interface UserProfile {
  phone: string;
  slug: string;
  name?: string;
  goals?: string;
  history: string[];
  raw: string;
}

function phoneToSlug(phone: string): string {
  // e.g. +14155551234 -> people/14155551234
  return `people/${phone.replace(/\D/g, "")}`;
}

export async function getOrCreateUser(phone: string): Promise<UserProfile> {
  const slug = phoneToSlug(phone);
  let raw = "";

  try {
    raw = await gbrainGet(slug);
  } catch {
    // new user — create a blank profile
    const initial = `# User ${phone}\n\nPhone: ${phone}\nJoined: ${new Date().toISOString().slice(0, 10)}\n\n## Goals\n\n(not set)\n\n## Food History\n\n(none yet)\n`;
    await gbrainPut(slug, initial);
    raw = initial;
  }

  return parseProfile(phone, slug, raw);
}

export async function appendHistory(phone: string, query: string, reply: string): Promise<void> {
  const slug = phoneToSlug(phone);
  let raw = "";
  try {
    raw = await gbrainGet(slug);
  } catch {
    return;
  }

  const entry = `- ${new Date().toISOString().slice(0, 10)}: "${query}" → ${reply.slice(0, 100)}`;
  if (raw.includes("## Food History")) {
    raw = raw.replace("## Food History\n\n(none yet)", `## Food History\n\n${entry}`);
    if (raw.includes("(none yet)") === false) {
      // already has entries, append
      const lines = raw.split("\n");
      const histIdx = lines.findIndex((l) => l.startsWith("## Food History"));
      if (histIdx !== -1) {
        lines.splice(histIdx + 2, 0, entry);
        raw = lines.join("\n");
      }
    }
  } else {
    raw += `\n## Food History\n\n${entry}\n`;
  }

  await gbrainPut(slug, raw);
}

function parseProfile(phone: string, slug: string, raw: string): UserProfile {
  const nameMatch = raw.match(/^# (.+)/m);
  const goalsSection = raw.match(/## Goals\s*\n([\s\S]*?)(?=\n##|$)/);
  const historySection = raw.match(/## Food History\s*\n([\s\S]*?)(?=\n##|$)/);

  const historyLines = (historySection?.[1] ?? "")
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));

  return {
    phone,
    slug,
    name: nameMatch?.[1],
    goals: goalsSection?.[1]?.trim(),
    history: historyLines,
    raw,
  };
}
