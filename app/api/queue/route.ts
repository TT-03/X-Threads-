import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const xUserId = cookieStore.get("x_user_id")?.value;

  if (!xUserId) {
    return NextResponse.json(
      { error: "Not connected to X (missing x_user_id cookie)" },
      { status: 401 }
    );
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();

  // ✅ 追加：x_tokens が無ければ未連携扱い（cookie残っても弾く）
  const { data: tok, error: tokErr } = await supabase
    .from("x_tokens")
    .select("access_token")
    .eq("user_id", xUserId)
    .maybeSingle();

  if (tokErr) {
    return NextResponse.json({ error: tokErr.message }, { status: 500 });
  }

  if (!tok?.access_token) {
    return NextResponse.json(
      { error: "Not connected to X (missing x_tokens)" },
      { status: 401 }
    );
  }

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
