import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearClientCookies(res: NextResponse) {
  // 画面側で使っている Cookie を全部消す
  const names = [
    "x_access_token",
    "x_refresh_token",
    "x_user_id",
    "x_username",
    "x_connected",
    // OAuth開始時に作っている可能性があるものも念のため
    "x_pkce_verifier",
    "x_oauth_state",
  ];

  for (const name of names) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}

export async function POST(req: Request) {
  // Cookie から user_id を取る（なければ body からも拾えるようにしておく）
  const ck = cookies();
  let userId = ck.get("x_user_id")?.value ?? "";

  if (!userId) {
    // body が空の POST もあるので try/catch
    try {
      const body = await req.json();
      userId = typeof body?.user_id === "string" ? body.user_id : "";
    } catch {
      // noop
    }
  }

  const resOk = NextResponse.json({ ok: true, user_id: userId || null });
  // 先に Cookie は必ず消す（DB エラーでも「解除ボタン」は体感的に成功にしたい）
  clearClientCookies(resOk);

  // user_id が取れないなら、Cookie だけ消して終了
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

  // ✅ Supabase 側の接続情報を「未連携状態」に戻す
  // ※ テーブル定義に合わせて x_access_token / x_refresh_token / x_expires_at を NULL にする
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
    // Cookie は消えているので、DB だけ失敗したことがわかるレスポンスにする
    const resNg = NextResponse.json(
      { ok: false, user_id: userId, error: "Failed to update x_connections", details: error },
      { status: 500 }
    );
    clearClientCookies(resNg);
    return resNg;
  }

  // 更新対象が無いケースでも ok:true 扱い（「解除」は成立）
  const res = NextResponse.json({
    ok: true,
    user_id: userId,
    db_cleared: !!data,
  });
  clearClientCookies(res);
  return res;
}
