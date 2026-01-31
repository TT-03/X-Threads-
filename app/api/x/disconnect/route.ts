import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function clearCookie(res: NextResponse, name: string) {
  // 既存cookieを確実に消すため、Path=/ で Max-Age=0
  res.cookies.set({
    name,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
  });
}

export async function POST(req: Request) {
  try {
    // user_id は cookie優先。なければ body でも受ける（MVP）
    const cookieStore = await cookies();
    const cookieUserId = cookieStore.get("x_user_id")?.value;

    let bodyUserId: string | undefined;
    try {
      const body = await req.json().catch(() => null);
      bodyUserId = body?.user_id ? String(body.user_id) : undefined;
    } catch {
      // ignore
    }

    const user_id = cookieUserId || bodyUserId;

    if (!user_id) {
      return NextResponse.json(
        { ok: false, error: "missing user_id (cookie x_user_id or body.user_id)" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // 連携解除＝アクセストークン/リフレッシュトークン/有効期限だけを消す
    // ※ Client ID / Secret / scopes は消さない（再連携で必要になるため）
    const now = new Date().toISOString();

    // row が無いケースにも備えて upsert（冪等）
    const { error: upsertErr } = await supabase
      .from("x_connections")
      .upsert(
        {
          user_id,
          x_access_token: null,
          x_refresh_token: null,
          x_expires_at: null,
          updated_at: now,
        },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      return NextResponse.json(
        { ok: false, error: "failed to update x_connections", details: upsertErr },
        { status: 500 }
      );
    }

    // ついでに、未使用になったOAuth stateを掃除（任意だけどおすすめ）
    await supabase.from("x_oauth_states").delete().eq("user_id", user_id);

    const res = NextResponse.json({ ok: true });

    // フロント側の表示用 cookie を確実に削除
    clearCookie(res, "x_access_token");
    clearCookie(res, "x_refresh_token");
    clearCookie(res, "x_user_id");
    clearCookie(res, "x_username");
    clearCookie(res, "x_connected");

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "internal_error", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
