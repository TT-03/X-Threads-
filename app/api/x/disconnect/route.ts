import { NextResponse } from "next/server";
import { getCookie, clearCookie } from "../../../_lib/cookies";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin";

export const runtime = "nodejs";

function jsonOk(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request) {
  // 1) user_id は Cookie 優先（なければ body / query も許可）
  const url = new URL(req.url);

  const cookieUserId = await getCookie("x_user_id");
  const queryUserId = url.searchParams.get("user_id") ?? undefined;

  let bodyUserId: string | undefined;
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => null);
      if (body && typeof body.user_id === "string") bodyUserId = body.user_id;
    }
  } catch {
    // ignore
  }

  const userId = cookieUserId || bodyUserId || queryUserId || "";

  // 2) まず Cookie は必ず消す（DB更新に失敗しても UI を未連携に寄せる）
  // あなたのレスポンスで見えていた Cookie を中心にクリア
  await clearCookie("x_access_token");
  await clearCookie("x_refresh_token");
  await clearCookie("x_user_id");
  await clearCookie("x_username");
  await clearCookie("x_connected");
  await clearCookie("x_scopes");
  await clearCookie("x_expires_at");

  // user_id が取れない場合でも、Cookieは消せたのでOKで返す
  if (!userId) {
    return jsonOk({ ok: true, disconnected: true, user_id: null, note: "no user_id; cookies cleared only" });
    }

  // 3) DB も消す（x_tokens を優先で削除、x_connections も未連携状態へ）
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // (a) x_tokens を削除（これが今の実体）
    const { error: delTokensErr } = await supabaseAdmin
      .from("x_tokens")
      .delete()
      .eq("user_id", userId);

    if (delTokensErr) {
      // x_tokens が無い/権限などもあり得るので、ログ用に返す
      // ただし Cookie は消してるので disconnected は true のまま返す
      return jsonOk({
        ok: false,
        disconnected: true,
        user_id: userId,
        warning: "failed to delete x_tokens",
        details: delTokensErr,
      }, 200);
    }

    // (b) x_connections も「未連携」へ（UIがこっちを見てる場合の対策）
    // カラムが nullable 前提。nullable でなければ '' にする必要があるかも。
    const { error: updConnErr } = await supabaseAdmin
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_expires_at: null,
        x_scopes: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    // x_connections が無い/使ってない構成でもあり得るので、ここは警告扱い
    if (updConnErr) {
      return jsonOk({
        ok: true,
        disconnected: true,
        user_id: userId,
        warning: "x_tokens deleted but failed to update x_connections",
        details: updConnErr,
      });
    }

    return jsonOk({ ok: true, disconnected: true, user_id: userId });
  } catch (e: any) {
    return jsonOk(
      { ok: false, disconnected: true, user_id: userId, error: "exception", details: String(e?.message ?? e) },
      200
    );
  }
}
