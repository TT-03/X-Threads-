import { NextResponse } from "next/server";
import { getCookie, setHttpOnlyCookie, clearCookie } from "../../../_lib/cookies";

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

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code/state" }, { status: 400 });
  }
  if (!expectedState || state !== expectedState) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  if (!verifier) {
    return NextResponse.json({ error: "Missing PKCE verifier (expired?)" }, { status: 400 });
  }

  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  const clientSecret = process.env.X_CLIENT_SECRET; // required for confidential client

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Missing env: X_CLIENT_ID / X_REDIRECT_URI" }, { status: 500 });
  }

  const form = new URLSearchParams();
  form.set("code", code);
  form.set("grant_type", "authorization_code");
  form.set("client_id", clientId);
  form.set("redirect_uri", redirectUri);
  form.set("code_verifier", verifier);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers["Authorization"] = basicAuthHeader(clientId, clientSecret);
  }

  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: form.toString(),
    cache: "no-store",
  });

  const tokenJson = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed", details: tokenJson },
      { status: 400 },
    );
  }

  // MVP: store access token in HttpOnly cookie (NOT recommended for production).
  // Production: encrypt and store in DB per user, store refresh token, handle rotation, etc.
  const accessToken = tokenJson?.access_token as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ error: "No access_token in response", details: tokenJson }, { status: 400 });
  }

  await setHttpOnlyCookie("x_access_token", accessToken, 60 * 60);

  await clearCookie("x_oauth_state");
  await clearCookie("x_pkce_verifier");


  return NextResponse.redirect(new URL("/app/compose", url.origin));
}
