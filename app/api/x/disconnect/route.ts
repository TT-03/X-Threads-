import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * cookie削除（Secure/HttpOnly/SameSite も合わせて「確実に」消す）
 * ※ domain は指定しない（環境差で消せない事故を避ける）
 */
function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: true, // Vercel(https)前提。ローカルで困る場合は false に
  });
}

async function handler() {
  const cookieStore = await cookies();
  const xUserId = cookieStore.get("x_user_id")?.value ?? null;

  // まずレスポンス（cookie削除）を作る
  const res = NextResponse.json({ ok: true });

  // Cookieを消す（画面側の「連携中」判定の原因を確実に消す）
  clearCookie(res, "x_access_token");
  clearCookie(res, "x_refresh_token");
  clearCookie(res, "x_user_id");
  clearCookie(res, "x_username");
  clearCookie(res, "x_connected");

  // DB側も未連携に戻す（トークン類をNULL）
  // ※ user_id が取れない場合は cookie だけ消して終了（DBは触らない）
  if (xUserId) {
    try {
      const supabase = getSupabaseAdmin();

      // いまの本命テーブル：x_connections
      // client_id/secret/scopes は残して「再連携しやすく」し、token類のみ破棄
      const { error: connErr } = await supabase
        .from("x_connections")
        .update({
          x_access_token: null,
          x_refresh_token: null,
          x_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", xUserId);

      // もしテーブル/カラム違い等があっても cookie は消せてるので、
      // ここでは落とさずログに寄せる（必要ならthrowに変えてOK）
      if (connErr) {
        console.error("[x/disconnect] failed to update x_connections:", connErr);
      }

      // 旧実装の互換：x_tokens が残ってる環境なら掃除
      // （存在しない場合はエラーになる可能性があるので try/catch）
      try {
        await supabase.from("x_tokens").delete().eq("user_id", xUserId);
      } catch (e) {
        // ignore
      }
    } catch (e) {
      console.error("[x/disconnect] unexpected error:", e);
      // cookieは消せてるので 200 のまま返す（必要なら 500 に変更可）
    }
  }

  return res;
}

export async function POST() {
  return handler();
}

export async function GET() {
  return handler();
}
