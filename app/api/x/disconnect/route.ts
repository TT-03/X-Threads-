import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * cookie を確実に削除する（Max-Age=0）
 * ※あなたの既存レスポンスヘッダが HttpOnly なしだったので、挙動を変えないため httpOnly は付けません
 *   （セキュリティ改善したい場合は access/refresh だけ HttpOnly にするのがおすすめ）
 */
function clearCookie(res: NextResponse, name: string) {
  res.cookies.set({
    name,
    value: "",
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // httpOnly: false（既存の挙動維持）
  });
}

export async function POST(req: Request) {
  try {
    // Next.js 16系：cookies() は Promise のため await 必須
    const ck = await cookies();

    // 基本は cookie の user_id で判定（フロントが body を送らない構成でも動く）
    let userId = ck.get("x_user_id")?.value ?? "";

    // 念のため body も見に行く（将来フロントが userId を送ってきても動く）
    if (!userId) {
      try {
        const body = await req.json();
        if (typeof body?.user_id === "string") userId = body.user_id;
      } catch {
        // content-length:0 のPOSTなどはここに来る。無視でOK
      }
    }

    // 先にレスポンスを作る（cookie削除は常に実施）
    const res = NextResponse.json({
      ok: true,
      disconnected: true,
      user_id: userId || null,
    });

    // UI/セッション系 cookie を削除（あなたのヘッダに出ていたもの一式）
    clearCookie(res, "x_access_token");
    clearCookie(res, "x_refresh_token");
    clearCookie(res, "x_user_id");
    clearCookie(res, "x_username");
    clearCookie(res, "x_connected");

    // DB 更新（user_id が取れた時だけ）
    if (userId) {
      const supabase = getSupabaseAdmin();

      const { error } = await supabase
        .from("x_connections")
        .update({
          x_access_token: null,
          x_refresh_token: null,
          x_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      // 失敗しても cookie は消えているので、情報だけ返す（運用でログ見たいなら console.error 推奨）
      if (error) {
        return NextResponse.json(
          { ok: false, error: "DB update failed", details: error },
          { status: 500 }
        );
      }
    }

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "disconnect failed", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
