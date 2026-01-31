// app/api/x/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false },
  });
}

function clearAuthCookies(res: NextResponse) {
  // 既存cookieの Path/Secure に合わせて削除できるよう、path="/" & secure を明示
  const common = {
    path: "/",
    sameSite: "lax" as const,
    secure: true, // https(Vercel)前提。ローカルhttpで試すなら false に。
    maxAge: 0,
  };

  const names = [
    "x_access_token",
    "x_refresh_token",
    "x_user_id",
    "x_username",
    "x_connected",
  ];

  for (const name of names) {
    res.cookies.set(name, "", common);
  }
}

export async function POST(req: NextRequest) {
  // 1) user_id を cookie か body から取る（どちらでもOKにしておく）
  const cookieUserId = req.cookies.get("x_user_id")?.value ?? "";

  let bodyUserId = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({} as any));
      bodyUserId = typeof body?.user_id === "string" ? body.user_id : "";
    }
  } catch {
    // ignore
  }

  const userId = cookieUserId || bodyUserId;

  // 2) 返すレスポンス（先に作って、必ずcookieは消す）
  const res = NextResponse.json(
    { ok: true, disconnected: true, user_id: userId || null },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    }
  );
  clearAuthCookies(res);

  // user_id が取れない場合でも cookie だけ消して終了（DBは触れない）
  if (!userId) return res;

  // 3) DB からも “接続情報/トークン” を消す
  //    - x_connections: token列をnull化（レコードは残す）
  //    - x_tokens: 行を削除（存在チェックに引っかからないように）
  try {
    const supabase = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // x_tokens を削除（ここが重要：UI/状態判定が x_tokens を見ている可能性が高い）
    await supabase.from("x_tokens").delete().eq("user_id", userId);

    // x_connections の token を null にする（存在するなら）
    await supabase
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_expires_at: null,
        updated_at: nowIso,
      })
      .eq("user_id", userId);

    // もし「x_connections のレコードが存在するだけで連携中」と判定してるなら、
    // 上の update だけでは足りないので、次の delete に切り替えてください：
    //
    // await supabase.from("x_connections").delete().eq("user_id", userId);
    //
  } catch (e) {
    // DB更新に失敗しても cookie は消しているので、クライアントは未連携扱いにできる
    // 必要ならここで console.error(e) を入れてください
  }

  return res;
}
