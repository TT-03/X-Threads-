import { NextResponse } from "next/server";
import { randomVerifier, challengeS256 } from "../../../_lib/pkce";
import { setHttpOnlyCookie } from "../../../_lib/cookies";

export async function GET() {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Missing env: X_CLIENT_ID / X_REDIRECT_URI" },
      { status: 500 },
    );
  }

  const verifier = randomVerifier(48);
  const challenge = challengeS256(verifier);
  const state = randomVerifier(24);

  // Store verifier+state in HttpOnly cookies (MVP). In production, bind to user session + DB.
  setHttpOnlyCookie("x_pkce_verifier", verifier, 10 * 60);
  setHttpOnlyCookie("x_oauth_state", state, 10 * 60);

  const scopes = process.env.X_SCOPES ?? "tweet.read tweet.write users.read offline.access";
  const authorizeUrl = new URL("https://x.com/i/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scopes);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(authorizeUrl.toString());
}
