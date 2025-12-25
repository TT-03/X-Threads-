import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { getCookie, setHttpOnlyCookie, clearCookie } from "../../../_lib/cookies";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin";

// 念のため（Buffer使うので）
export const runtime = "nodejs";

function basicAuthHeader(clientId: string, clientSecret: string) {
  const token = Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64");
  return `Basic ${token}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const expectedState = await getCookie("x_oauth_state");
  const verifier = await getCookie("x_pkce_verifier");

  if (!code || !state) return NextResponse.json({ error: "Missing code/state" }, { status: 400 });
  if (!expectedState || state !== expectedState) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  if (!verifier) return NextResponse.json({ error: "Missing PKCE verifier (expired?)" }, { status: 400 });

  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Missing env: X_CLIENT_ID / X_REDIRECT_URI" }, { status: 500 });
  }

  const form = new URLSearchParams();
  form.set("code", code);
  form.set("grant_type", "authorization_code");
  form.set("client_id", clientId);
  form.set("redirect_uri", redirectUri);
  form.set("code_verifier", verifier);

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientSecret) headers["Authorization"] = basicAuthHeader(clientId, clientSecret);

  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: form.toString(),
    cache: "no-store",
  });

  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed", details: tokenJson }, { status: 400 });
  }

  const accessToken = tokenJson?.access_token as string | undefined;
  const refreshToken = tokenJson?.refresh_token as string | undefined;
  const expiresIn = tokenJson?.expires_in as number | undefined;

  if (!accessToken) {
    return NextResponse.json({ error: "No access_token in response", details: tokenJson }, { status: 400 });
  }

  // ✅ user_idを取る（users.read がスコープに必要）
  const meRes = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const meJson = await meRes.json().catch(() => ({}));
  const userId = meJson?.data?.id as string | undefined;

  if (!meRes.ok || !userId) {
    return NextResponse.json(
      { error: "Failed to fetch users/me (need users.read scope?)", details: meJson },
      { status: 400 }
    );
  }

  // ✅ DBへ保存（予約Cronがここから取る）
  const expiresAt =
    typeof expiresIn === "number"
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

  // ✅ ここでチェック（ここが一番安全）
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { error: upsertErr } = await supabaseAdmin.from("x_tokens").upsert({
    user_id: userId,
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (upsertErr) {
    return NextResponse.json({ error: "Failed to upsert x_tokens", details: upsertErr }, { status: 500 });
  }

  // ✅ 追加：再連携成功時、auth_required を pending に戻して早めに再実行させる
try {
  const runAtSoon = new Date(Date.now() + 30_000).toISOString();

  const { data, error: bumpErr } = await supabaseAdmin
    .from("scheduled_posts")
    .update({
      status: "pending",
      run_at: runAtSoon,
      attempts: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "auth_required")
    .select("id");

  if (bumpErr) {
    console.error("Failed to bump auth_required -> pending:", bumpErr);
  } else {
    console.log(`bumped auth_required -> pending: ${data?.length ?? 0} jobs`);
  }
} catch (e) {
  console.error("Exception while bumping auth_required -> pending:", e);
}

  // UI用：user_id を Cookieに入れる（これで予約APIが user_id を使える）
  await setHttpOnlyCookie("x_user_id", userId, 60 * 60 * 24 * 30);

  // 互換のため残してもOK（ただし予約CronはDBを使う）
  await setHttpOnlyCookie("x_access_token", accessToken, 60 * 60);

  await clearCookie("x_oauth_state");
  await clearCookie("x_pkce_verifier");

  return NextResponse.redirect(new URL("/compose", url.origin));
}
