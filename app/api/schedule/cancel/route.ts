import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json({ error: "Not connected. Missing x_user_id cookie." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = (body?.id ?? "").toString();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();

    // pending / running だけキャンセル可能に（sent/failedは触らない）
    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .select("id, status")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to cancel", details: error }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found or cannot cancel" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, cancelled: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "Unexpected error", details: String(e?.message ?? e) }, { status: 500 });
  }
}
