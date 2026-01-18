import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * 入力（どれか1つでOK）
 * ① 従来：{ id }
 * ② 新：  { group_id }  または { groupId }
 *
 * オプション：
 * - provider: "x" | "threads"（指定するとそのproviderだけキャンセル）
 *
 * キャンセルできる status は pending / running / needs_user_action
 */
export async function POST(req: Request) {
  try {
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json({ error: "Not connected. Missing x_user_id cookie." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const id = (body?.id ?? "").toString();
    const groupId = (body?.group_id ?? body?.groupId ?? "").toString();
    const provider = (body?.provider ?? "").toString().toLowerCase(); // "x" or "threads" or ""

    if (!id && !groupId) {
      return NextResponse.json({ error: "id or group_id is required" }, { status: 400 });
    }

    if (provider && provider !== "x" && provider !== "threads") {
      return NextResponse.json({ error: "provider must be 'x' or 'threads'" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // ✅ キャンセル可能なステータス（Threads用 needs_user_action も含める）
    const cancellableStatuses = ["pending", "running", "needs_user_action"];

    // どこを条件にするか
    let q = supabaseAdmin
      .from("scheduled_posts")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("status", cancellableStatuses);

    if (provider) q = q.eq("provider", provider);

    if (groupId) {
      q = q.eq("group_id", groupId);
    } else {
      q = q.eq("id", id);
    }

    // groupキャンセルの場合は複数行になるので single() は使わない
    const { data, error } = await q.select("id, group_id, provider, status");

    if (error) {
      return NextResponse.json({ error: "Failed to cancel", details: error }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Not found or cannot cancel" }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, cancelled: data, cancelled_count: data.length },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: "Unexpected error", details: String(e?.message ?? e) }, { status: 500 });
  }
}
