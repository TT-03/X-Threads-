import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json({ error: "Not connected. Missing x_user_id cookie." }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .select("id, provider, text, run_at, status, attempts, last_error, tweet_id, updated_at")
      .eq("user_id", userId)
      .order("run_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: "Failed to select scheduled_posts", details: error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, items: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "Unexpected error", details: String(e?.message ?? e) }, { status: 500 });
  }
}
