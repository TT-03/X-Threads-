import crypto from "crypto";

function getKey(): Buffer {
  const b64 = process.env.X_OAUTH_MASTER_KEY;
  if (!b64) throw new Error("Missing X_OAUTH_MASTER_KEY");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("X_OAUTH_MASTER_KEY must be 32 bytes (base64)");
  return key;
}

export function encryptText(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptText(b64: string): string {
  const key = getKey();
  const raw = Buffer.from(b64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plain.toString("utf8");
}
