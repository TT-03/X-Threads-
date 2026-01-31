import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptText } from "@/lib/crypto";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") || "";
  const state = searchParams.get("state") || "";

  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "missing code/state" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // state → user_id, verifier
  const { data: st } = await supabase
    .from("x_oauth_states")
    .select("user_id, code_verifier")
    .eq("state", state)
    .maybeSingle();

  if (!st) {
    return NextResponse.json({ ok: false, error: "invalid state" }, { status: 400 });
  }

  const user_id = st.user_id;
  const code_verifier = st.code_verifier;

  // userのx_client_id/secret取得
  const { data: conn } = await supabase
    .from("x_connections")
    .select("x_client_id, x_client_secret_enc, x_scopes")
    .eq("user_id", user_id)
    .maybeSingle();

  if (!conn) {
    return NextResponse.json({ ok: false, error: "missing connection" }, { status: 400 });
  }

  const client_id = conn.x_client_id;
  const client_secret = decryptText(conn.x_client_secret_enc);
  const redirect_uri = process.env.X_CALLBACK_URL!;

  // code → token
  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");

  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      code_verifier,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "token exchange failed", detail: json }, { status: 400 });
  }

  const access_token = json.access_token as string;
  const refresh_token = json.refresh_token as string | undefined;
  const expires_in = Number(json.expires_in || 0);
  const expires_at = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

  await supabase.from("x_connections").update({
    x_access_token: access_token,
    x_refresh_token: refresh_token ?? null,
    x_expires_at: expires_at,
    updated_at: new Date().toISOString(),
  }).eq("user_id", user_id);

  await supabase.from("x_oauth_states").delete().eq("state", state);

  // 連携完了後の戻り先（あなたの画面に変更OK）
  return NextResponse.redirect(new URL("/settings?x=connected", req.url));
}
