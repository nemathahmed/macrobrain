import { supabase } from "./db.ts";

const PORT = parseInt(process.env.DASHBOARD_PORT ?? "3001");

function extractDeal(content: string): string {
  const m = content.match(/## (?:Business Update|Deals & Specials)([\s\S]*?)(?=\n## |$)/);
  return m ? m[1].trim().replace(/\n+/g, " ").slice(0, 180) : "";
}

function slugToName(slug: string): string {
  return slug
    .replace(/^concepts\//, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function maskPhone(phone: string): string {
  return phone.replace(/(\+\d{1,2})(\d{3})(\d{3})(\d{4})/, "$1 $2 *** $4");
}

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>macrobrain — admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #070c10;
      --surface: #0e1519;
      --border: rgba(255,255,255,0.07);
      --text: #f2ede8;
      --muted: #6b7580;
      --accent: #e8622a;
    }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; min-height: 100vh; }

    header {
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .logo { font-size: 0.95rem; font-weight: 700; letter-spacing: -0.02em; }
    .logo span { color: var(--accent); }
    .live-badge { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--muted); }
    .dot { width: 7px; height: 7px; background: #2d9c4a; border-radius: 50%; animation: pulse 2s ease-in-out infinite; flex-shrink: 0; }
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border-bottom: 1px solid var(--border);
    }
    .stat { padding: 1.5rem 2rem; border-right: 1px solid var(--border); }
    .stat:last-child { border-right: none; }
    .stat-num { font-size: 2rem; font-weight: 800; letter-spacing: -0.04em; line-height: 1; margin-bottom: 0.3rem; }
    .stat-num .accent { color: var(--accent); }
    .stat-label { font-size: 0.72rem; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      height: calc(100vh - 120px);
    }
    .panel { border-right: 1px solid var(--border); overflow-y: auto; }
    .panel:last-child { border-right: none; }
    .panel-header {
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.68rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      position: sticky;
      top: 0;
      background: var(--bg);
      z-index: 2;
    }
    .count { display: inline-block; margin-left: 0.5rem; background: var(--accent); color: #fff; font-size: 0.6rem; padding: 0.1rem 0.45rem; border-radius: 10px; font-weight: 700; letter-spacing: 0; vertical-align: middle; }

    .deal-item, .msg-item {
      padding: 1.1rem 2rem;
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
    }
    .deal-item:hover, .msg-item:hover { background: var(--surface); }

    .deal-name { font-size: 0.82rem; font-weight: 600; color: var(--text); margin-bottom: 0.35rem; }
    .deal-text { font-size: 0.8rem; color: var(--muted); line-height: 1.5; margin-bottom: 0.5rem; }
    .deal-meta { font-size: 0.68rem; color: #3d5060; }
    .deal-tag { display: inline-block; background: rgba(232,98,42,0.12); color: var(--accent); border-radius: 4px; padding: 0.15rem 0.5rem; font-size: 0.65rem; font-weight: 600; margin-right: 0.4rem; letter-spacing: 0.04em; }

    .msg-phone { font-size: 0.78rem; color: var(--muted); margin-bottom: 0.4rem; display: flex; justify-content: space-between; }
    .msg-q { font-size: 0.82rem; color: var(--text); margin-bottom: 0.3rem; }
    .msg-a { font-size: 0.78rem; color: rgba(232,98,42,0.85); line-height: 1.45; }
    .msg-a::before { content: "→ "; opacity: 0.5; }

    .empty { padding: 3rem 2rem; text-align: center; color: var(--muted); font-size: 0.82rem; }

    #toast { position: fixed; bottom: 1.5rem; right: 1.5rem; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 0.75rem; padding: 0.6rem 1rem; border-radius: 8px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    #toast.show { opacity: 1; }

    @media (max-width: 700px) {
      .stats { grid-template-columns: 1fr 1fr; }
      .grid { grid-template-columns: 1fr; height: auto; }
      .panel { height: 50vh; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">macro<span>brain</span> <span style="color:var(--muted);font-weight:400;font-size:0.8rem;margin-left:0.25rem">admin</span></div>
    <div class="live-badge"><span class="dot"></span><span id="refresh-label">refreshes every 30s</span></div>
  </header>

  <div class="stats">
    <div class="stat"><div class="stat-num" id="s-deals">—</div><div class="stat-label">Total Deals</div></div>
    <div class="stat"><div class="stat-num" id="s-users">—</div><div class="stat-label">Users</div></div>
    <div class="stat"><div class="stat-num" id="s-msgs">—</div><div class="stat-label">Messages</div></div>
    <div class="stat"><div class="stat-num" id="s-biz">—</div><div class="stat-label">Restaurants</div></div>
  </div>

  <div class="grid">
    <div class="panel">
      <div class="panel-header">Recent Deals<span class="count" id="deals-count">0</span></div>
      <div id="deals-feed"><div class="empty">Loading…</div></div>
    </div>
    <div class="panel">
      <div class="panel-header">Live Conversations<span class="count" id="msgs-count">0</span></div>
      <div id="msgs-feed"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <div id="toast">Updated</div>

  <script>
    async function fetchStats() {
      const r = await fetch("/api/stats");
      const d = await r.json();
      document.getElementById("s-deals").textContent = d.deals ?? "—";
      document.getElementById("s-users").textContent = d.users ?? "—";
      document.getElementById("s-msgs").textContent = d.messages ?? "—";
      document.getElementById("s-biz").textContent = d.businesses ?? "—";
    }

    async function fetchDeals() {
      const r = await fetch("/api/deals");
      const deals = await r.json();
      document.getElementById("deals-count").textContent = deals.length;
      const feed = document.getElementById("deals-feed");
      if (!deals.length) { feed.innerHTML = '<div class="empty">No deals yet. Restaurants can text in specials or wait for the Hog to run.</div>'; return; }
      feed.innerHTML = deals.map(d => \`
        <div class="deal-item">
          <div class="deal-name">\${d.name || d.slug.replace("concepts/","").replace(/-/g," ").replace(/\\b\\w/g,c=>c.toUpperCase())}</div>
          <div class="deal-text">\${d.preview || "No deal text parsed"}</div>
          <div class="deal-meta">
            <span class="deal-tag">\${d.source}</span>
            \${d.updated_at ? timeAgo(d.updated_at) : ""}
          </div>
        </div>
      \`).join("");
    }

    async function fetchMsgs() {
      const r = await fetch("/api/history");
      const msgs = await r.json();
      document.getElementById("msgs-count").textContent = msgs.length;
      const feed = document.getElementById("msgs-feed");
      if (!msgs.length) { feed.innerHTML = '<div class="empty">No conversations yet.</div>'; return; }
      feed.innerHTML = msgs.map(m => \`
        <div class="msg-item">
          <div class="msg-phone"><span>\${maskPhone(m.phone)}</span><span>\${timeAgo(m.created_at)}</span></div>
          <div class="msg-q">\${esc(m.message)}</div>
          <div class="msg-a">\${esc(m.reply.slice(0, 160))}\${m.reply.length > 160 ? "…" : ""}</div>
        </div>
      \`).join("");
    }

    function timeAgo(ts) {
      const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (diff < 60) return diff + "s ago";
      if (diff < 3600) return Math.floor(diff / 60) + "m ago";
      if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
      return Math.floor(diff / 86400) + "d ago";
    }

    function maskPhone(p) { return p.replace(/(\\+\\d{1,2})(\\d{3})(\\d{3})(\\d{4})/, "$1 $2 *** $4"); }
    function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

    function showToast() {
      const t = document.getElementById("toast");
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 1800);
    }

    async function refresh() {
      await Promise.all([fetchStats(), fetchDeals(), fetchMsgs()]);
      showToast();
    }

    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/stats") {
      const [users, history, deals, businesses] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase.from("history").select("*", { count: "exact", head: true }),
        supabase.from("deals").select("*", { count: "exact", head: true }),
        supabase.from("businesses").select("*", { count: "exact", head: true }),
      ]);
      return Response.json({
        users: users.count ?? 0,
        messages: history.count ?? 0,
        deals: deals.count ?? 0,
        businesses: businesses.count ?? 0,
      });
    }

    if (url.pathname === "/api/deals") {
      const { data } = await supabase
        .from("deals")
        .select("slug, content, updated_at")
        .order("updated_at", { ascending: false })
        .limit(60);

      const rows = (data ?? []).map((row) => {
        const preview = extractDeal(row.content);
        // Determine source: Business Update = restaurant-sent, Deals & Specials = Hog
        const source = row.content.includes("## Business Update") ? "restaurant" : "hog";
        return { slug: row.slug, name: slugToName(row.slug), preview, source, updated_at: row.updated_at };
      });

      return Response.json(rows);
    }

    if (url.pathname === "/api/history") {
      const { data } = await supabase
        .from("history")
        .select("phone, message, reply, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      return Response.json(data ?? []);
    }

    return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

console.log(`macrobrain dashboard → http://localhost:${PORT}`);
