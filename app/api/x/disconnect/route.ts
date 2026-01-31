// app/api/x/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function clearCookie(res: NextResponse, name: string) {
  // 既存実装に合わせて Path=/ で削除
  res.cookies.set({
    name,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

export async function POST(req: NextRequest) {
  try {
    // Supabase admin が使える前提
    mustEnv("SUPABASE_URL");
    mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // user_id は cookie 優先（UIの実装が cookie を付けているため）
    const cookieUserId = req.cookies.get("x_user_id")?.value;

    // body からも受けられるようにしておく（将来用 / curl 用）
    let bodyUserId: string | undefined;
    try {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await req.json().catch(() => null);
        bodyUserId = json?.user_id || json?.userId;
      }
    } catch {
      // body が空でもOK
    }

    const userId = cookieUserId || bodyUserId;
    if (!userId) {
      const res = NextResponse.json(
        { ok: false, error: "Missing user_id (cookie x_user_id or body.user_id)" },
        { status: 400 }
      );

      // 失敗時でも一応 cookie は掃除しておく
      [
        "x_access_token",
        "x_refresh_token",
        "x_user_id",
        "x_username",
        "x_connected",
        "x_scopes",
        "x_pkce_verifier",
        "x_oauth_state",
      ].forEach((k) => clearCookie(res, k));

      return res;
    }

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // 1) x_connections を確実に「未連携状態」に戻す
    const { error: updErr } = await supabase
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_expires_at: null,
        x_scopes: null,
        updated_at: now,
      })
      .eq("user_id", userId);

    if (updErr) {
      // DB 更新に失敗しても cookie は掃除して返す（UI上は未連携にできる）
      const res = NextResponse.json(
        { ok: false, error: "Failed to update x_connections", details: updErr },
        { status: 500 }
      );

      [
        "x_access_token",
        "x_refresh_token",
        "x_user_id",
        "x_username",
        "x_connected",
        "x_scopes",
        "x_pkce_verifier",
        "x_oauth_state",
      ].forEach((k) => clearCookie(res, k));

      return res;
    }

    // 2) もし x_oauth_states テーブルがあるなら、その user の state を掃除（無くてもOK）
    //    ※テーブル未作成/権限などで失敗しても握りつぶす
    try {
      await supabase.from("x_oauth_states").delete().eq("user_id", userId);
    } catch {
      // noop
    }

    // 3) cookie を全掃除
    const res = NextResponse.json({ ok: true });

    [
      "x_access_token",
      "x_refresh_token",
      "x_user_id",
      "x_username",
      "x_connected",
      "x_scopes",
      "x_pkce_verifier",
      "x_oauth_state",
    ].forEach((k) => clearCookie(res, k));

    return res;
  } catch (e: any) {
    const res = NextResponse.json(
      { ok: false, error: e?.message || "disconnect failed" },
      { status: 500 }
    );

    // 例外でも cookie は掃除
    [
      "x_access_token",
      "x_refresh_token",
      "x_user_id",
      "x_username",
      "x_connected",
      "x_scopes",
      "x_pkce_verifier",
      "x_oauth_state",
    ].forEach((k) => clearCookie(res, k));

    return res;
  }
}
