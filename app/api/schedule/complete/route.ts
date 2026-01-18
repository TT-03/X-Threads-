import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * 目的：Threadsの「手動投稿が完了した」をユーザーが宣言するAPI
 *
 * 入力（どれか1つでOK）
 * ① { id } ・・・ scheduled_posts の1行を完了にする
 * ② { group_id } or { groupId } ・・・ グループ内をまとめて完了
 *
 * オプション：
 * - provider: "threads" | "x"（指定するとそのproviderだけ完了）
 *
 * 完了にできる status：
 * - needs_user_action（想定メイン）
 * - pending / running（手動で完了扱いにしたい場合にも対応）
 */
export async function POST(req: Request) {
  try {
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json(
        { error: "Not connected. Missing x_user_id cookie." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const id = (body?.id ?? "").toString();
    const groupId = (body?.group_id ?? body?.groupId ?? "").toString();
    const provider = (body?.provider ?? "").toString().toLowerCase(); // "threads" or "x" or ""

    if (!id && !groupId) {
      return NextResponse.json({ error: "id or group_id is required" }, { status: 400 });
    }
    if (provider && provider !== "x" && provider !== "threads") {
      return NextResponse.json({ error: "provider must be 'x' or 'threads'" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // ✅ 完了にできるステータス
    const completableStatuses = ["needs_user_action", "pending", "running"];

    let q = supabaseAdmin
      .from("scheduled_posts")
      .update({
        status: "sent",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .in("status", completableStatuses);

    if (provider) q = q.eq("provider", provider);
    if (groupId) q = q.eq("group_id", groupId);
    else q = q.eq("id", id);

    const { data, error } = await q.select("id, group_id, provider, status");

    if (error) {
      return NextResponse.json({ error: "Failed to complete", details: error }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Not found or cannot complete" }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, completed: data, completed_count: data.length },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
