import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function safeJson(req: Request): Promise<any | null> {
  try {
    // body が空の POST の場合はここで例外になるので握りつぶす
    return await req.json();
  } catch {
    return null;
  }
}

function expireCookie(res: NextResponse, name: string) {
  // path を揃えないと消えないケースがあるので "/" 固定
  res.cookies.set({
    name,
    value: "",
    path: "/",
    maxAge: 0,
  });
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();

  // Next の cookies() は環境によって Promise 返すので await で統一
  const cookieStore = await cookies();

  const body = await safeJson(req);

  // 優先：Cookie → fallback：body
  const userId =
    cookieStore.get("x_user_id")?.value ??
    (body?.user_id ? String(body.user_id) : "");

  if (!userId) {
    const res = NextResponse.json(
      { ok: false, disconnected: false, error: "missing user_id" },
      { status: 400 }
    );
    // 念のため cookie は消す（壊れた状態を引きずらない）
    ["x_access_token", "x_refresh_token", "x_user_id", "x_username", "x_connected"].forEach(
      (k) => expireCookie(res, k)
    );
    return res;
  }

  // 1) x_tokens（実トークンが入ってるテーブル）を削除
  const delTokens = await supabase.from("x_tokens").delete().eq("user_id", userId);

  // 2) x_connections（画面で見てるっぽい）も NULL クリアして updated_at 更新
  //    ※カラムが存在しない環境でも落ちないように、まず update を試して失敗しても続行
  const updateConnections = await supabase
    .from("x_connections")
    .update({
      x_access_token: null,
      x_refresh_token: null,
      x_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  // Cookie を削除して返す
  const res = NextResponse.json({
    ok: true,
    disconnected: true,
    user_id: userId,
    db: {
      x_tokens_deleted: !delTokens.error,
      x_tokens_error: delTokens.error?.message ?? null,
      x_connections_updated: !updateConnections.error,
      x_connections_error: updateConnections.error?.message ?? null,
    },
  });

  ["x_access_token", "x_refresh_token", "x_user_id", "x_username", "x_connected"].forEach(
    (k) => expireCookie(res, k)
  );

  return res;
}
