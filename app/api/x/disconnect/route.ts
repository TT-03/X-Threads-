import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

async function readUserId(req: Request): Promise<string | null> {
  // 1) Cookie 優先
  const ck = await cookies();
  const fromCookie = ck.get("x_user_id")?.value;
  if (fromCookie) return fromCookie;

  // 2) 念のため body(JSON) も見る（空のPOSTでもOKにする）
  try {
    const body = await req.json().catch(() => null);
    const fromBody = body?.user_id || body?.userId;
    if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;
  } catch {
    // ignore
  }

  return null;
}

export async function POST(req: Request) {
  let userId: string | null = null;

  try {
    userId = await readUserId(req);

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "missing user_id (cookie x_user_id not found)" },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // ✅ x_connections のトークンを NULL にする（=連携解除）
    const { error } = await supabaseAdmin
      .from("x_connections")
      .update({
        x_access_token: null,
        x_refresh_token: null,
        x_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "failed to update x_connections", details: error },
        { status: 500 }
      );
    }

    const res = NextResponse.json({ ok: true, disconnected: true, user_id: userId });

    // ✅ Cookieも削除（UIの表示や誤判定防止）
    const clear = (name: string) => {
      res.cookies.set({
        name,
        value: "",
        path: "/",
        maxAge: 0,
      });
    };

    clear("x_access_token");
    clear("x_refresh_token");
    clear("x_user_id");
    clear("x_username");
    clear("x_connected");

    // OAuth時に使ったものも一応消す
    clear("x_oauth_state");
    clear("x_pkce_verifier");

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "disconnect exception", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
