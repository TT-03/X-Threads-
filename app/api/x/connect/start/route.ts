import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { encryptText } from "@/lib/crypto";

export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// PKCE
function base64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function sha256(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest();
}

export async function POST(req: Request) {
  // ここは「ログイン済み user_id」を受け取る想定（MVP）
  // 実運用ではSupabase AuthのJWT検証に置き換えてください。
  const body = await req.json();
  const user_id = String(body.user_id || "");
  const x_client_id = String(body.x_client_id || "");
  const x_client_secret = String(body.x_client_secret || "");
  const x_scopes = String(body.x_scopes || "tweet.read tweet.write users.read offline.access");

  if (!user_id || !x_client_id || !x_client_secret) {
    return NextResponse.json({ ok: false, error: "missing params" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // secretを暗号化して保存
  await supabase.from("x_connections").upsert(
    {
      user_id,
      x_client_id,
      x_client_secret_enc: encryptText(x_client_secret),
      x_scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  // state & verifier
  const state = crypto.randomBytes(16).toString("hex");
  const code_verifier = base64url(crypto.randomBytes(32));
  const code_challenge = base64url(sha256(code_verifier));

  await supabase.from("x_oauth_states").insert({
    state,
    user_id,
    code_verifier,
  });

  const redirect_uri = process.env.X_CALLBACK_URL!;
  const authorizeUrl =
    "https://twitter.com/i/oauth2/authorize" +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(x_client_id)}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
    `&scope=${encodeURIComponent(x_scopes)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(code_challenge)}` +
    `&code_challenge_method=S256`;

  return NextResponse.json({ ok: true, authorizeUrl });
}
