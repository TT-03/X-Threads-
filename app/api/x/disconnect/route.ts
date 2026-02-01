import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false },
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
    });
  }
}

export async function POST(req: NextRequest) {
  // cookie優先。念のためbodyでも受けられるようにする（bodyが空でもOK）
  const cookieUserId = req.cookies.get("x_user_id")?.value;

  let bodyUserId = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      bodyUserId = typeof body?.user_id === "string" ? body.user_id : "";
    }
  } catch {
    // 何もしない（bodyが空のPOSTでも動かす）
  }

  const userId = cookieUserId || bodyUserId || "";

  const supabase = getSupabaseAdmin();

  // 先にレスポンスを作って cookie を確実に消す
  const res = NextResponse.json(
    { ok: true, disconnected: true, user_id: userId || null },
    { status: 200 }
  );

  // キャッシュさせない
  res.headers.set("cache-control", "no-store");
  clearAuthCookies(res);

  // DB側の削除（失敗しても cookie は消えて返す）
  if (supabase && userId) {
    try {
      // 1) x_tokens を削除（あなたの環境ではここに実トークンが入っている）
      await supabase.from("x_tokens").delete().eq("user_id", userId);

      // 2) x_connections 側も念のためnullに（UIや別ロジックが見ていてもズレない）
      await supabase
        .from("x_connections")
        .update({
          x_access_token: null,
          x_refresh_token: null,
          x_expires_at: null,
          x_scopes: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } catch {
      // ここで失敗しても、フロントの連携解除（cookie削除）は成立させる
    }
  }

  return res;
}
