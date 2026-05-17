import { supabase } from "./db.ts";

export interface UserProfile {
  phone: string;
  goals: string;
  memory: string;
  history: string[];
}

export async function getOrCreateUser(phone: string): Promise<UserProfile> {
  await supabase.from("users").upsert({ phone }, { onConflict: "phone", ignoreDuplicates: true });

  const { data: user } = await supabase
    .from("users")
    .select("goals, memory")
    .eq("phone", phone)
    .single();

  const { data: rows } = await supabase
    .from("history")
    .select("message, reply")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(6);

  const history = (rows ?? [])
    .reverse()
    .map((r: { message: string; reply: string }) => `"${r.message}" → ${r.reply.slice(0, 80)}`);

  return {
    phone,
    goals: user?.goals ?? "",
    memory: user?.memory ?? "",
    history,
  };
}

export async function updateGoals(phone: string, goals: string): Promise<void> {
  await supabase.from("users").update({ goals }).eq("phone", phone);
}

export async function updateMemory(phone: string, memory: string): Promise<void> {
  await supabase.from("users").update({ memory }).eq("phone", phone);
}

export async function appendHistory(phone: string, message: string, reply: string): Promise<void> {
  await supabase.from("history").insert({ phone, message, reply });
}
