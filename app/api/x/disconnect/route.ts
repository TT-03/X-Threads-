import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * X 連携解除:
 * - DB: x_connections の token 系を null にする（存在しなければ upsert で作って null）
 * - Cookie: x_* 系を削除
 */
export async function POST(req: Request) {
  try {
    // user_id は cookie 優先。なければ body の user_id を拾う（保険）
    let userId = "";

    const cookieHeader = req.headers.get("cookie") ?? "";
    const m = cookieHeader.match(/(?:^|;\s*)x_user_id=([^;]+)/);
    if (m?.[1]) userId = decodeURIComponent(m[1]);

    if (!userId) {
      // content-length 0 のことが多いが、念のため
      try {
        const body = await req.json();
        if (body?.user_id) userId = String(body.user_id);
      } catch {
        // ignore
      }
    }

    if (!userId) {
      const res = NextResponse.json(
        { ok: false, disconnected: false, error: "missing x_user_id" },
        { status: 400 }
      );
      // cookie だけでも消しておく
      clearAllXCookies(res);
      return res;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      const res = NextResponse.json(
        {
          ok: false,
          disconnected: false,
          error: "Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
      clearAllXCookies(res);
      return res;
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const now = new Date().toISOString();

    // token を確実に消す（row が無くても upsert で作って null にする）
    const { error } = await supabase
      .from("x_connections")
      .upsert(
        {
          user_id: userId,
          x_access_token: null,
          x_refresh_token: null,
          x_expires_at: null,
          updated_at: now,
        },
        { onConflict: "user_id" }
      );

    if (error) {
      const res = NextResponse.json(
        { ok: false, disconnected: false, error: "db upsert failed", details: error },
        { status: 500 }
      );
      clearAllXCookies(res);
      return res;
    }

    const res = NextResponse.json({ ok: true, disconnected: true, user_id: userId });
    clearAllXCookies(res);
    return res;
  } catch (e: any) {
    const res = NextResponse.json(
      { ok: false, disconnected: false, error: "unexpected", details: String(e?.message ?? e) },
      { status: 500 }
    );
    clearAllXCookies(res);
    return res;
  }
}

function clearAllXCookies(res: NextResponse) {
  const base = { path: "/", maxAge: 0 as const };

  // 既存で使ってそうなキーは全部消す
  res.cookies.set({ name: "x_access_token", value: "", ...base });
  res.cookies.set({ name: "x_refresh_token", value: "", ...base });
  res.cookies.set({ name: "x_user_id", value: "", ...base });
  res.cookies.set({ name: "x_username", value: "", ...base });
  res.cookies.set({ name: "x_connected", value: "", ...base });

  // OAuth フロー途中の state / verifier も念のため
  res.cookies.set({ name: "x_oauth_state", value: "", ...base });
  res.cookies.set({ name: "x_pkce_verifier", value: "", ...base });
}
