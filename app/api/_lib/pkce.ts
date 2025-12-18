import crypto from "crypto";

export function base64UrlEncode(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomVerifier(len = 64) {
  // RFC 7636: 43-128 chars. We'll generate a URL-safe string.
  return base64UrlEncode(crypto.randomBytes(len));
}

export function challengeS256(verifier: string) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(hash);
}
