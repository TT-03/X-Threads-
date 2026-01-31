import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function clearAuthCookies(res: NextResponse) {
  const names = [
    "x_access_token",
    "x_refresh_token",
    "x_user_id",
    "x_username",
    "x_connected",
  ];

  for (const name of names) {
    res.cookies.set({
      name,
      value: "",
      maxAge: 0,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1) user_id を Cookie優先で取得（なければ body も見る）
    const fromCookie = req.cookies.get("x_user_id")?.value;

    let fromBody: string | undefined;
    try {
      const body = await req.json().catch(() => null);
      fromBody = body?.user_id || body?.userId || body?.uid;
    } catch {
      // body無しでもOK
    }

    const userId = fromCookie || fromBody;

    if (!userId) {
      const res = NextResponse.json(
        { ok: false, error: "Missing user_id (cookie x_user_id or body.user_id)" },
        { status: 400 }
      );
      clearAuthCookies(res);
      return res;
    }

    // 2) DB 側のトークンを確実に無効化
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // x_connections：トークン列をNULLに
    const { error: connErr } = await supabase
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_expires_at: null,
        updated_at: now,
      })
      .eq("user_id", userId);

    if (connErr) {
      // ここで止めるとCookieが残るので、Cookieは必ず消して返す
      const res = NextResponse.json(
        { ok: false, error: "Failed to update x_connections", details: connErr, user_id: userId },
        { status: 500 }
      );
      clearAuthCookies(res);
      return res;
    }

    // x_tokens：行ごと削除（存在しなくてもOK）
    const { error: tokErr } = await supabase.from("x_tokens").delete().eq("user_id", userId);

    if (tokErr) {
      const res = NextResponse.json(
        { ok: false, error: "Failed to delete x_tokens", details: tokErr, user_id: userId },
        { status: 500 }
      );
      clearAuthCookies(res);
      return res;
    }

    // 3) Cookie を全消しして完了
    const res = NextResponse.json({ ok: true, disconnected: true, user_id: userId });
    clearAuthCookies(res);
    return res;
  } catch (e: any) {
    const res = NextResponse.json(
      { ok: false, error: "Unexpected error", details: String(e?.message ?? e) },
      { status: 500 }
    );
    clearAuthCookies(res);
    return res;
  }
}

// （必要なら）プリフライト対策
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
