import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function handler(_req: any, res: any) {
  const { data } = await supabase
    .from("history")
    .select("phone, message, reply, created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data ?? []));
}
