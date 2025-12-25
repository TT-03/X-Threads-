import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", {
    path: "/",
    maxAge: 0,
  });
}

async function handler() {
  // cookieに x_user_id が残ってると「未連携なのに一覧が出る」ので必ず消す
  const cookieStore = await cookies();
  const xUserId = cookieStore.get("x_user_id")?.value;

  // （任意）DB側のトークンも消す：これで完全に未連携状態になる
  if (xUserId && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = getSupabaseAdmin();
    await supabase.from("x_tokens").delete().eq("user_id", xUserId);
  }

  const res = NextResponse.json({ ok: true });

  // ✅ あなたの現状のcookie
  clearCookie(res, "x_access_token");
  clearCookie(res, "x_refresh_token");

  // ✅ 予約一覧の判定で使っているcookie（これが残ってるのが原因）
  clearCookie(res, "x_user_id");

  // ✅ もし使ってるなら一緒に（無害なので消してOK）
  clearCookie(res, "x_username");
  clearCookie(res, "x_connected");

  return res;
}

export async function POST() {
  return handler();
}

export async function GET() {
  return handler();
}
