import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCookie } from "../../../_lib/cookies";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET() {
  try {
    const user_id = (await getCookie("x_user_id")) || "";

    if (!user_id) {
      return NextResponse.json({
        ok: true,
        user_id: null,
        connected: false,
        reason: "no_x_user_id_cookie",
      });
    }

    const supabase = getSupabaseAdmin();

    // 1) 正：x_tokens を見て連携判定する
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("x_tokens")
      .select("access_token, refresh_token, expires_at, updated_at")
      .eq("user_id", user_id)
      .maybeSingle();

    if (tokenErr) {
      return NextResponse.json(
        { ok: false, where: "x_tokens", message: tokenErr.message, user_id },
        { status: 500 }
      );
    }

    const has_access_token = Boolean(tokenRow?.access_token);
    const has_refresh_token = Boolean(tokenRow?.refresh_token);
    const token_expires_at = tokenRow?.expires_at ?? null;
    const token_updated_at = tokenRow?.updated_at ?? null;

    const connected = has_access_token || has_refresh_token;

    // 2) 参考：x_connections（scopes/更新日時など）
    const { data: connRow } = await supabase
      .from("x_connections")
      .select("x_scopes, x_expires_at, updated_at, x_access_token, x_refresh_token")
      .eq("user_id", user_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      user_id,
      connected,
      has_access_token,
      has_refresh_token,
      token_expires_at,
      token_updated_at,
      x_scopes: connRow?.x_scopes ?? null,
      x_connections_expires_at: connRow?.x_expires_at ?? null,
      x_connections_updated_at: connRow?.updated_at ?? null,

      // デバッグ用：connections側に入ってる/入ってない確認
      conn_has_access_token: Boolean(connRow?.x_access_token),
      conn_has_refresh_token: Boolean(connRow?.x_refresh_token),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
