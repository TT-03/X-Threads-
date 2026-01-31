import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearClientCookies(res: NextResponse) {
  const names = [
    "x_access_token",
    "x_refresh_token",
    "x_user_id",
    "x_username",
    "x_connected",
    "x_pkce_verifier",
    "x_oauth_state",
  ];

  for (const name of names) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}

export async function POST(req: Request) {
  // ✅ Next.jsのcookies()はPromiseになることがあるので await 必須
  const ck = await cookies();

  // Cookie から user_id を取る（なければ body からも拾えるようにしておく）
  let userId = ck.get("x_user_id")?.value ?? "";

  if (!userId) {
    try {
      const body = await req.json();
      userId = typeof body?.user_id === "string" ? body.user_id : "";
    } catch {
      // bodyなしでもOK
    }
  }

  // 先に Cookie は必ず消す（DBエラーでも画面側は解除状態に戻す）
  const resOk = NextResponse.json({ ok: true, user_id: userId || null });
  clearClientCookies(resOk);

  // user_id が取れないなら Cookie だけ消して終了
  if (!userId) {
    return resOk;
  }

  // 環境変数チェック（サービスロールで更新する想定）
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // ✅ DBの接続情報を未連携状態に戻す
  const { data, error } = await supabase
    .from("x_connections")
    .update({
      x_access_token: null,
      x_refresh_token: null,
      x_expires_at: null,
      updated_at: now,
    })
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    const resNg = NextResponse.json(
      { ok: false, user_id: userId, error: "Failed to update x_connections", details: error },
      { status: 500 }
    );
    clearClientCookies(resNg);
    return resNg;
  }

  const res = NextResponse.json({
    ok: true,
    user_id: userId,
    db_cleared: !!data, // 対象行がなくても解除は成立
  });
  clearClientCookies(res);
  return res;
}
