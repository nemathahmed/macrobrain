# ForkSF

**SF's Food Brain** — [forksf.com](https://www.forksf.com)

Text it. Get the right spot for your macros, neighborhood, and tonight's deals — instantly, over iMessage.

---

## The frustration that built this

Every time I'm out with friends in SF, the same 10 minutes die deciding where to eat. It sounds trivial until you do the math:

> **10 min × 3 meals/day × 365 days = 182 hours/year** lost to "where should we go?"

And that's just time. Add in the cognitive overhead of cross-referencing deals, dietary goals, and who's closest — and it's genuinely broken.

Last night I was in Marina at Pacific Catch. They had a $9 spicy tuna roll happy hour — one of the best deals I've seen in the city. The place was empty. I asked the waitress why. *"Not a lot of people know about it."*

That was the moment. A great restaurant with a great deal, invisible to everyone walking by.

I've been building [Shifu Health](https://shifu.health) — a health and fitness AI. The macro-awareness layer, the personalization, the memory system — all of it applies directly to food decisions. Yesterday night I merged both problems. Today, ForkSF is born.

A few hours. One hackathon. Real SMS. Real restaurants. Real deals.

---

## What it does

You text ForkSF like a friend: *"high protein dinner in Dogpatch"* or *"good deal near Hayes Valley"* — it texts back the dish, the macros, the deal, and the address so you can tap straight to navigation.

It knows 1,100+ SF restaurants and dishes. It knows what's on special tonight. It remembers your goals, what you've ordered, what you liked — and gets sharper every conversation.

---

## For restaurants: your deals, surfaced

Small restaurants lose customers every day to invisibility. A great happy hour that nobody sees is a deal that doesn't exist.

ForkSF gives any SF restaurant a direct line to hungry locals:
- **Text your deal** to the ForkSF number — *"half-price cocktails 5–7pm tonight"* — and it's live in the brain within seconds, surfaced to every relevant user query
- **No app, no dashboard, no integration** — just iMessage, the way you already communicate
- Zero cost to participate. When someone asks for a deal near you, ForkSF finds it

This is the equalizer. A 12-table neighborhood spot with a great Tuesday special can compete with a restaurant that has a $50k marketing budget — because the best deal wins, not the loudest ad.

---

## How the brain stays current

Three pipelines feed it every day:

**The Hog** — runs at 6am daily. Deep-researches each restaurant's website and Instagram: happy hours, standing specials, events, deals. Writes structured intel into each restaurant's brain page. Discovery pass runs once per restaurant; daily pass scrapes only what's changed.

**Restaurants texting in** — direct iMessage from the restaurant's phone. Parsed by the agent, formatted cleanly, written to gbrain tagged as `Business Update` so users and provenance are tracked separately from Hog data. We ran outreach to 100+ SF restaurants at launch.

**Zero Entropy semantic search** — all 1,100+ pages indexed and queryable by intent. *"Light and clean, trying to cut"* surfaces Souvla's rotisserie chicken (70g protein, 6g carbs) without the user saying "Greek" or "Souvla." Keyword search is the fallback.

---

## Architecture

```
User SMS
  ↓
Spectrum/Photon (iMessage SDK)
  ↓
src/index.ts — message router
  ├── Restaurant phone? → parse deal → write to gbrain
  └── User? → load profile + memory → Claude Sonnet
                                          ↓
                                 Zero Entropy semantic search
                                 (keyword fallback)
                                          ↓
                                 SMS reply + address (tap to navigate)
                                 + background memory update (Haiku)
```

**Stack:** Bun · TypeScript · Supabase · Zero Entropy · OpenRouter (Claude Sonnet/Haiku) · Spectrum/Photon (iMessage) · The Hog · Vercel

---

## How we built it — the gstack sprint

Built in one session using Claude Code + [gstack](https://github.com/garrynsk/gstack) skills:

**`/office-hours`** — scoped the wedge before writing code. Not "restaurant discovery" (solved), but the macro-aware, deal-aware layer that sits on top of any food decision.

**`/investigate`** — Supabase writes silently failing (RLS blocking the anon key, history table empty, users not persisting). `/investigate` traced it to the bot process starting before the service key fix landed on disk. One targeted fix, nothing else touched.

**`/freeze`** — locked edits to `src/` during live SMS handler work. Prevented Claude from refactoring the ingestion pipeline while debugging the SMS endpoint.

**`/learn`** — captured the Zero Entropy SDK gotcha (Python docs: `top_snippets`, TypeScript SDK: `topSnippets`) and the Supabase service key distinction. Durable across the whole session.

**`/qa`** — ran against the admin dashboard. Found API routes returning 500s (shared `_db` module failing in Vercel's Node runtime). Fixed before demo.

**`/cso`** — OWASP pass on the SMS handler and admin. Flagged known gaps, documented them.

---

## Admin dashboard

[forksf.com/admin.html](https://www.forksf.com/admin.html) — live deal feed, conversation stream, user + restaurant counts. Auto-refreshes every 30s.

---

## Running locally

```bash
bun install
cp .env.example .env
bun --env-file=.env src/index.ts        # SMS bot
bun --env-file=.env src/dashboard.ts    # admin dashboard
bun --env-file=.env src/index-ze.ts     # index into Zero Entropy (one-time)
bun --env-file=.env src/hog.ts          # daily intel pipeline
```

**Required env vars:** `OPENROUTER_API_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `PHOTON_PROJECT_ID` · `PHOTON_SECRET_KEY` · `ZEROENTROPY_API_KEY` · `HOG_ACCESS_KEY` · `HOG_SECRET_KEY`

---

Built at the YC AI hackathon, May 2026.
