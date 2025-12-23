import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  // URLは NEXT_PUBLIC_SUPABASE_URL を流用してOK（サーバー側でも読める）
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing env: SUPABASE_URL(or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
