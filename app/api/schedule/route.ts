import { NextResponse } from "next/server";
import { getCookie } from "../_lib/cookies";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
const text = (body?.text ?? "").toString();
const provider = (body?.provider ?? "x").toString();

// ✅ runAt / run_at 両対応
const runAtRaw = body?.runAt ?? body?.run_at;
const runAt = (runAtRaw ?? "").toString();

    // cookie（callbackで入れたやつ）
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json({ error: "Not connected. Missing x_user_id cookie." }, { status: 401 });
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }
    if (text.length > 280) {
      return NextResponse.json({ error: "Text is too long (max 280)" }, { status: 400 });
    }

    const dt = new Date(runAt);
    if (!runAt || Number.isNaN(dt.getTime())) {
      return NextResponse.json({ error: "runAt is invalid (ISO string required)" }, { status: 400 });
    }
    if (dt.getTime() < Date.now() + 10_000) {
      return NextResponse.json({ error: "runAt must be in the future" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .insert({
        user_id: userId,
        provider,
        text,
        run_at: dt.toISOString(),
        status: "pending",
        attempts: 0,
        last_error: null,
        tweet_id: null,
        updated_at: new Date().toISOString(),
      })
      .select("id, user_id, provider, run_at, status")
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to insert scheduled_posts", details: error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, scheduled: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "Unexpected error", details: String(e?.message ?? e) }, { status: 500 });
  }
}
