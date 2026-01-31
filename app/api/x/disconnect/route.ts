// app/api/x/disconnect/route.ts
import { NextResponse } from "next/server";
import { getCookie, clearCookie } from "../../../_lib/cookies";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // まず Cookie から user_id を取る（UIはこれを持ってる前提）
    let userId = await getCookie("x_user_id");

    // Cookie に無い場合は body から拾えるようにしておく（保険）
    if (!userId) {
      try {
        const body = await req.json().catch(() => null);
        if (body?.user_id) userId = String(body.user_id);
      } catch {
        // ignore
      }
    }

    if (!userId) {
      // Cookie も body も無いなら「cookie削除だけ」して返す
      await Promise.all([
        clearCookie("x_access_token"),
        clearCookie("x_refresh_token"),
        clearCookie("x_user_id"),
        clearCookie("x_username"),
        clearCookie("x_connected"),
        clearCookie("x_oauth_state"),
        clearCookie("x_pkce_verifier"),
      ]);

      return NextResponse.json(
        { ok: true, disconnected: true, user_id: null, note: "no user_id; cookies cleared only" },
        { status: 200 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) まず「行ごと削除」を試す（UIが“行の存在”で連携判定してても確実に未連携になる）
    const del = await supabaseAdmin.from("x_connections").delete().eq("user_id", userId);

    // delete が権限/制約で失敗した場合は 2) NULL更新でフォールバック
    if (del.error) {
      const upd = await supabaseAdmin
        .from("x_connections")
        .update({
          x_access_token: null,
          x_refresh_token: null,
          x_expires_at: null,
          x_scopes: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (upd.error) {
        return NextResponse.json(
          { ok: false, error: "Failed to disconnect", details: { delete_error: del.error, update_error: upd.error } },
          { status: 500 }
        );
      }
    }

    // 3) Cookie は必ず消す（UI側の表示・APIの誤判定防止）
    await Promise.all([
      clearCookie("x_access_token"),
      clearCookie("x_refresh_token"),
      clearCookie("x_user_id"),
      clearCookie("x_username"),
      clearCookie("x_connected"),
      clearCookie("x_oauth_state"),
      clearCookie("x_pkce_verifier"),
    ]);

    return NextResponse.json({ ok: true, disconnected: true, user_id: userId }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Unhandled error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
