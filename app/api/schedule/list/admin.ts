import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/lib/database.types"; // 既にある型に合わせて

export async function requireAdmin() {
  const supabase = createRouteHandlerClient<Database>({ cookies });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return { ok: false as const, status: 401, user: null };

  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const isAdmin = admins.includes(user.email.toLowerCase());
  if (!isAdmin) return { ok: false as const, status: 403, user };

  return { ok: true as const, status: 200, user };
}
