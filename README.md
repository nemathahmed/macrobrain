# macrobrain

**San Francisco's Food Brain** — [forksf.com](https://www.forksf.com)

Text a number. Get the right meal for your macros, neighborhood, and tonight's deals — instantly, over iMessage.

---

## What it does

macrobrain is an SMS food assistant for San Francisco. You text it like a friend: *"high protein dinner in Dogpatch"* or *"what's good near Hayes Valley under $20"* — and it texts back a specific dish, the macros, the deal if there is one, and the address so you can tap straight to navigation.

It knows 1,100+ SF restaurants and dishes. It knows what's on special tonight. It remembers what you've eaten, what you like, and what your goals are — and gets sharper with every exchange.

---

## How the brain stays current

Most food apps have stale data. macrobrain has three live pipelines feeding it every day:

**The Hog** (`src/hog.ts`) runs at 6am daily. It's a two-tier intelligence pipeline:
- *Discovery* (once per restaurant): deep research up to 500 credits — scrapes the restaurant website, finds their Instagram handle, extracts happy hour schedules, standing deals, upcoming events. Writes a structured `## Deals & Specials` section into each restaurant's brain page.
- *Daily*: pulls the latest 10 Instagram posts per restaurant and any specials page updates. Keeps the brain current without burning credits on restaurants that haven't changed.

**Restaurants texting in** (`src/business.ts`): restaurants can iMessage their own deals directly to macrobrain. We ran outreach to 100+ SF restaurants. When a restaurant texts "half-price saganaki tonight 5–8pm," the agent parses it, formats it cleanly, and writes it into gbrain as a `## Business Update` section — tagged separately from Hog-sourced data so we know the provenance.

**Zero Entropy** (`src/gbrain.ts`, `src/index-ze.ts`): all 1,100+ restaurant and dish pages are indexed into a Zero Entropy collection (`sf-restaurants`). When a user query comes in, we run semantic search first — `ze.queries.topSnippets()` with `precise_responses: true` — which understands *intent* rather than just keywords. "Light and clean, trying to cut" surfaces Souvla's rotisserie chicken (70g protein, 6g carbs) even though the user never said "Greek" or "Souvla." Keyword search is the fallback when ZE has no hits.

---

## Architecture

```
User SMS
  ↓
Spectrum/Photon (iMessage SDK)
  ↓
src/index.ts — message router
  ├── Known restaurant phone? → handleBusinessText() → gbrain update
  └── User? → getOrCreateUser() → answerFoodQuery()
                                        ↓
                               Claude Sonnet via OpenRouter
                               + tools: search_brain, query_brain,
                                        get_page, update_user_goals
                                        ↓
                               Zero Entropy semantic search
                               (falls back to keyword scoring)
                                        ↓
                               SMS reply + address for tap-to-navigate
                               + background memory update (Haiku)
```

**Stack:** Bun · TypeScript · Supabase (users, history, deals) · Zero Entropy (semantic search) · OpenRouter (Claude Sonnet) · Spectrum/Photon (iMessage) · The Hog (daily intel) · Vercel (dashboard + API)

---

## User memory

Every user gets a rolling notes field — free-form text the agent rewrites after each conversation. It logs meals eaten, macros consumed, cuisines they liked or avoided, neighborhoods they frequent, budget signals. The agent reads these notes on every query so it doesn't ask the same questions twice. Memory updates run on Claude Haiku in the background so they never add latency to the reply.

---

## Admin dashboard

Live at [forksf.com/admin.html](https://www.forksf.com/admin.html)

Shows real-time: total deals, users, messages, restaurants. Left panel: recent deals with source tags (`restaurant` vs `hog`). Right panel: live conversation feed (phones masked). Auto-refreshes every 30s. Served via Vercel serverless functions hitting Supabase directly.

---

## How we built it — the gstack sprint

Built in a single session using Claude Code + [gstack](https://github.com/garrynsk/gstack) skills. Here's how each skill shaped the build:

**`/office-hours`** — started here. Six forcing questions that exposed the real wedge: not "restaurant discovery" (solved), but the macro-awareness layer that sits on top of any food decision. Helped scope down to the SMS-first, protein-forward angle before writing a line of code.

**`/investigate`** — hit a wall when all Supabase writes were silently failing (RLS blocking the anon key, users and history tables staying empty). Rather than shotgun-fixing env vars, `/investigate` traced the root cause: the bot process had started before the service key fix was saved to disk. Iron Law: no fixes without root cause. One targeted fix, nothing else broken.

**`/freeze`** — used during live SMS handler and agent prompt work. Locked edits to `src/` only while the bot was running against a real iMessage number. Prevented Claude from helpfully refactoring the ingestion pipeline while debugging the SMS endpoint.

**`/learn`** — captured the Zero Entropy SDK gotcha (Python docs show `top_snippets`, TypeScript SDK uses camelCase `topSnippets`) and the Supabase service key vs anon key distinction. Both available to Claude for the rest of the session without re-explaining.

**`/qa`** — ran against the admin dashboard at forksf.com/admin.html. Clicked through the login flow, verified the stats panel, deals feed, and conversation feed all populated correctly. Found the API routes returning 500s (shared `_db` module import failing in Vercel's Node runtime) — fixed before demo.

**`/cso`** — security pass on the SMS handler and admin dashboard. Flagged: admin credentials hardcoded client-side (known, acceptable for internal demo), phone numbers in history table (masked in dashboard), no rate limiting on inbound SMS (noted for post-demo). OWASP Top 10 checked.

---

## Running locally

```bash
# Install
bun install

# Copy and fill in env vars
cp .env.example .env

# Run the bot
bun --env-file=.env src/index.ts

# Run the dashboard
bun --env-file=.env src/dashboard.ts

# Index restaurants into Zero Entropy (one-time)
bun --env-file=.env src/index-ze.ts

# Run the Hog pipeline (daily intel)
bun --env-file=.env src/hog.ts
```

**Required env vars:** `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PHOTON_PROJECT_ID`, `PHOTON_SECRET_KEY`, `ZEROENTROPY_API_KEY`, `HOG_ACCESS_KEY`, `HOG_SECRET_KEY`

---

## Schema

```sql
users      — phone, goals, memory, created_at
history    — phone, message, reply, created_at
businesses — phone, restaurant_slug, restaurant_name
deals      — slug, content, updated_at
```

Run `schema.sql` once in the Supabase SQL editor to initialize.

---

Built at the YC AI hackathon, May 2026.
