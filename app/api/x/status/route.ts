import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE;

  if (!url) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey)
    throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)");

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

/**
 * GET /api/x/status
 * - Cookie: x_user_id を優先
 * - x_tokens を見て connected 判定（x_connections は補助情報）
 */
export async function GET(req: NextRequest) {
  try {
    const userId =
      req.cookies.get("x_user_id")?.value ||
      req.nextUrl.searchParams.get("user_id") ||
      "";

    if (!userId) {
      return NextResponse.json(
        { ok: true, connected: false, reason: "no_user_id" },
        { status: 200 }
      );
    }

    const supabase = getSupabaseAdmin();

    // 1) x_tokens（実トークンが入っているテーブル）
    const { data: tok, error: tokErr } = await supabase
      .from("x_tokens")
      .select("access_token, refresh_token, expires_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokErr) throw tokErr;

    const hasAccessToken = !!tok?.access_token;
    const hasRefreshToken = !!tok?.refresh_token;

    // 2) x_connections（スコープ等の補助）
    const { data: conn, error: connErr } = await supabase
      .from("x_connections")
      .select("x_scopes, x_expires_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (connErr) throw connErr;

    const connected = hasAccessToken && hasRefreshToken;

    return NextResponse.json(
      {
        ok: true,
        user_id: userId,
        connected,
        // 連携判定は x_tokens 由来（ここが重要）
        has_access_token: hasAccessToken,
        has_refresh_token: hasRefreshToken,

        // 参考情報（UI表示用に使える）
        token_expires_at: tok?.expires_at ?? null,
        token_updated_at: tok?.updated_at ?? null,
        x_scopes: conn?.x_scopes ?? null,
        x_connections_expires_at: conn?.x_expires_at ?? null,
        x_connections_updated_at: conn?.updated_at ?? null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
