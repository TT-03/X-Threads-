import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCookie } from "../../_lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabaseAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  // Cookie ë§
  const userId = (await getCookie("x_user_id")) || "";
  const accessToken = (await getCookie("x_access_token")) || "";
  const hasCookieToken = Boolean(accessToken);

  // DB ë§Åix_tokens Çå©ÇÈÅj
  let hasDbToken = false;
  let dbExpiresAt: string | null = null;

  const admin = getSupabaseAdmin();
  if (admin && userId) {
    const { data, error } = await admin
      .from("x_tokens")
      .select("expires_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      hasDbToken = true;
      dbExpiresAt = data.expires_at ?? null;
    }
  }

  const connected = hasCookieToken || hasDbToken;

  return NextResponse.json(
    {
      connected,
      user_id: userId || null,
      has_cookie_token: hasCookieToken,
      has_db_token: hasDbToken,
      db_expires_at: dbExpiresAt,
      note:
        !admin
          ? "Supabase admin env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) is not set; DB check skipped."
          : null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}
