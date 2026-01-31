import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function expireCookie(res: NextResponse, name: string) {
  // NextResponse.cookies.set は Max-Age=0 の削除cookieを返せます
  res.cookies.set({
    name,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

export async function POST(req: NextRequest) {
  try {
    // 基本はcookieの x_user_id を使う（あなたのNetworkログでもここに入っている）
    let user_id = req.cookies.get("x_user_id")?.value ?? "";

    // 念のため、JSON body で user_id を送ってくる実装にも対応
    if (!user_id) {
      const body = await req.json().catch(() => null);
      if (body?.user_id) user_id = String(body.user_id);
    }

    if (!user_id) {
      return NextResponse.json(
        { ok: false, error: "missing user_id" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // DB上の接続情報を「未連携」に戻す（token/expires をNULL化）
    const { error } = await supabase
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user_id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "db update failed", detail: error.message },
        { status: 500 }
      );
    }

    // ついでに未使用のstateが残ってたら掃除（任意）
    await supabase.from("x_oauth_states").delete().eq("user_id", user_id);

    // ブラウザ側の「連携中」判定に使っているcookieを全消し
    const res = NextResponse.json({ ok: true });

    [
      "x_access_token",
      "x_refresh_token",
      "x_user_id",
      "x_username",
      "x_connected",
      // start側で付けている可能性があるPKCE/state cookieも掃除
      "x_pkce_verifier",
      "x_oauth_state",
    ].forEach((name) => expireCookie(res, name));

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "unexpected error", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
