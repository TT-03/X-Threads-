import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isProd = process.env.NODE_ENV === "production";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

function clearCookie(res: NextResponse, name: string) {
  // path=/ を必ず合わせる（これがズレると消えない）
  res.cookies.set(name, "", {
    path: "/",
    maxAge: 0,
    secure: isProd,
    sameSite: "lax",
  });
}

async function resolveUserId(req: NextRequest): Promise<string | null> {
  // Next.js（現行）では cookies() が Promise のことがあるので await
  const store = await cookies();
  const fromCookie = store.get("x_user_id")?.value;
  if (fromCookie) return fromCookie;

  // 念のため body からも拾えるようにしておく（空POSTの可能性があるので try）
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => null);
      const id = body?.user_id ?? body?.x_user_id ?? null;
      return typeof id === "string" && id.length ? id : null;
    }
  } catch {
    // noop
  }

  return null;
}

async function disconnectInDb(userId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { skipped: true, reason: "missing SUPABASE env" as const };
  }

  // 1) x_tokens を確実に削除（ここにトークンが残ると「解除したのに残ってる」になる）
  const delTokens = await supabase
    .from("x_tokens")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (delTokens.error) {
    return { ok: false as const, step: "delete x_tokens", error: delTokens.error.message };
  }

  // 2) x_connections 側のトークン列も null に（UI/判定がこちらを見ているなら必須）
  const updConn = await supabase
    .from("x_connections")
    .update({
      x_access_token: null,
      x_refresh_token: null,
      x_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updConn.error) {
    return { ok: false as const, step: "update x_connections", error: updConn.error.message };
  }

  return {
    ok: true as const,
    x_tokens_deleted: delTokens.count ?? null,
  };
}

async function handle(req: NextRequest) {
  const userId = await resolveUserId(req);

  const res = NextResponse.json({
    ok: true,
    disconnected: true,
    user_id: userId,
    db: userId ? await disconnectInDb(userId) : { skipped: true, reason: "no user_id" },
  });

  // 認証・表示に使ってそうな cookie をまとめて消す
  clearCookie(res, "x_access_token");
  clearCookie(res, "x_refresh_token");
  clearCookie(res, "x_user_id");
  clearCookie(res, "x_username");
  clearCookie(res, "x_connected");

  return res;
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
