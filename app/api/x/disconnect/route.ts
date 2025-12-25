import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", { path: "/", maxAge: 0 });
}

async function handler() {
  const cookieStore = await cookies();
  const xUserId = cookieStore.get("x_user_id")?.value;

  // （任意）DB側のトークンも削除して完全に未連携へ
  if (xUserId && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = getSupabaseAdmin();
    await supabase.from("x_tokens").delete().eq("user_id", xUserId);
  }

  const res = NextResponse.json({ ok: true });

  // 既存のcookie
  clearCookie(res, "x_access_token");
  clearCookie(res, "x_refresh_token");

  // 未連携でも一覧が出る原因cookie
  clearCookie(res, "x_user_id");

  // 使ってる可能性があるもの（無害なので一緒に）
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
