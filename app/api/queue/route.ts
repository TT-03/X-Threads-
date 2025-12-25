import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = cookies();
  const xUserId = cookieStore.get("x_user_id")?.value;

  if (!xUserId) {
    return NextResponse.json(
      { error: "Not connected to X (missing x_user_id cookie)" },
      { status: 401 }
    );
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("id, provider, text, run_at, status, attempts, last_error, tweet_id, updated_at")
    .eq("user_id", xUserId)
    .order("run_at", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
