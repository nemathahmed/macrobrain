import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function handler(_req: any, res: any) {
  const [users, history, deals, businesses] = await Promise.all([
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase.from("history").select("*", { count: "exact", head: true }),
    supabase.from("deals").select("*", { count: "exact", head: true }),
    supabase.from("businesses").select("*", { count: "exact", head: true }),
  ]);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    users: users.count ?? 0,
    messages: history.count ?? 0,
    deals: deals.count ?? 0,
    businesses: businesses.count ?? 0,
  }));
}
