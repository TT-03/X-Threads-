import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE env. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
}

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true, disconnected: true });

  // まず cookie は必ず消す（DB失敗してもブラウザ側は未連携に倒す）
  clearAuthCookies(res);

  // user_id は cookie 優先（body 空POSTもあるため）
  const cookieStore = await cookies();
  const cookieUserId = cookieStore.get("x_user_id")?.value;

  // 一応 body からも拾えるようにする（将来用）
  let bodyUserId: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.user_id === "string") bodyUserId = body.user_id;
  } catch {
    // body無し/JSONでない場合は無視
  }

  const userId = bodyUserId || cookieUserId || "";

  if (!userId) {
    // user_id が取れなくても cookie は消したのでOK扱い
    return res;
  }

  try {
    const supabase = getSupabaseAdmin();

    // 1) x_tokens を削除（連携解除の本体）
    const del = await supabase
      .from("x_tokens")
      .delete()
      .eq("user_id", userId);

    // 2) x_connections 側の token系も NULL にしておく（UI がこちらを見るなら必須）
    const upd = await supabase
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_scopes: null,
        x_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    // DB結果をレスポンスに乗せる（デバッグしやすい）
    return NextResponse.json(
      {
        ok: true,
        disconnected: true,
        user_id: userId,
        deleted_tokens_error: del.error?.message ?? null,
        updated_connections_error: upd.error?.message ?? null,
      },
      { headers: res.headers }
    );
  } catch (e: any) {
    // DBが落ちても cookie は消してあるので「未連携」にはなる
    return NextResponse.json(
      {
        ok: false,
        disconnected: true,
        user_id: userId,
        error: e?.message ?? String(e),
      },
      { headers: res.headers, status: 200 }
    );
  }
}
