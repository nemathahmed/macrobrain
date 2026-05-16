import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function migrate(): Promise<void> {
  const { error } = await supabase.from("users").select("phone").limit(1);
  if (error) {
    console.warn("⚠️  DB tables not found. Run schema.sql in Supabase SQL editor:");
    console.warn("   https://supabase.com/dashboard/project/goqtityiywctjexzyjdu/sql/new");
  } else {
    console.log("✓ DB ready");
  }
}
