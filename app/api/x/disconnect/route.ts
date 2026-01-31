import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getCookieValue(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  // very small cookie parser
  const parts = cookie.split(";").map((v) => v.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function clearAuthCookies(res: NextResponse) {
  const common = { path: "/", maxAge: 0 as const };
  res.cookies.set("x_access_token", "", common);
  res.cookies.set("x_refresh_token", "", common);
  res.cookies.set("x_user_id", "", common);
  res.cookies.set("x_username", "", common);
  res.cookies.set("x_connected", "", common);
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();

  // cookie から user_id を取る（無い場合は body も見る）
  let user_id = getCookieValue(req, "x_user_id");

  if (!user_id) {
    try {
      const body = await req.json();
      if (typeof body?.user_id === "string") user_id = body.user_id;
    } catch {
      // body が空でもOK
    }
  }

  if (!user_id) {
    const res = NextResponse.json(
      { ok: false, error: "missing user_id (cookie x_user_id or body.user_id)" },
      { status: 400 }
    );
    clearAuthCookies(res);
    return res;
  }

  // 1) x_connections 側の token を NULL にする（存在していれば）
  await supabase
    .from("x_connections")
    .update({
      x_access_token: null,
      x_refresh_token: null,
      x_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user_id);

  // 2) x_tokens 側も削除（こちらに実トークンが入っている可能性が高い）
  await supabase.from("x_tokens").delete().eq("user_id", user_id);

  // 3) 未完了 state が残っていたら掃除（任意だけど安全）
  await supabase.from("x_oauth_states").delete().eq("user_id", user_id);

  // 4) cookie を確実に消す（NextResponse 側で set-cookie を返す）
  const res = NextResponse.json({ ok: true, disconnected: true, user_id });
  clearAuthCookies(res);
  return res;
}
