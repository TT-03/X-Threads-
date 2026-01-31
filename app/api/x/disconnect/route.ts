// app/api/x/disconnect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function clearAuthCookies(res: NextResponse) {
  const opts = { path: "/", maxAge: 0 };

  res.cookies.set("x_access_token", "", opts);
  res.cookies.set("x_refresh_token", "", opts);
  res.cookies.set("x_user_id", "", opts);
  res.cookies.set("x_username", "", opts);
  res.cookies.set("x_connected", "", opts);

  // OAuth startで使ってる場合があるので念のため
  res.cookies.set("x_oauth_state", "", opts);
  res.cookies.set("x_pkce_verifier", "", opts);
}

export async function POST(req: NextRequest) {
  // 1) user_id を cookie or body から取得
  const cookieUserId = req.cookies.get("x_user_id")?.value;

  let bodyUserId: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.user_id === "string") bodyUserId = body.user_id;
  } catch {
    // bodyなしでもOK
  }

  const userId = cookieUserId || bodyUserId;
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Missing user_id (cookie x_user_id or body.user_id)" },
      { status: 400 }
    );
  }

  // 2) DB: x_connections の token を確実に消す（NULLにする）
  try {
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

    if (error) {
      console.error("disconnect: failed to update x_connections:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to update x_connections", details: error },
        { status: 500 }
      );
    }

    // 3) Cookie を確実に消す
    const res = NextResponse.json({ ok: true, disconnected: true, user_id: userId });
    clearAuthCookies(res);
    return res;
  } catch (e: any) {
    console.error("disconnect: exception:", e);
    return NextResponse.json(
      { ok: false, error: "disconnect exception", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
