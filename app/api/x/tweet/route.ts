import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookie } from "../../_lib/cookies";

const CONNECT_URL = "/accounts";

const Body = z.object({
  text: z.string().min(1).max(10000),
});

function pickDetail(payload: any) {
  if (typeof payload?.detail === "string") return payload.detail;
  if (typeof payload?.errors?.[0]?.message === "string") return payload.errors[0].message;
  if (typeof payload?.title === "string") return payload.title;
  if (typeof payload?.message === "string") return payload.message;
  return "";
}

// JSONが返らないケースにも備える
async function readResponse(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    return { json: text ? JSON.parse(text) : {}, rawText: text };
  } catch {
    return { json: { raw: text }, rawText: text };
  }
}

// Xのrate limit reset(UNIX秒)から retryAfter秒を作る（なければnull）
function getRetryAfterSeconds(res: Response): number | null {
  // 1) Retry-After があれば最優先
  const ra = res.headers.get("retry-after");
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n) && n > 0) return Math.min(60 * 60, Math.ceil(n));
  }

  // 2) x-rate-limit-reset (UNIX秒) があればそこから計算
  const reset = res.headers.get("x-rate-limit-reset");
  if (reset) {
    const resetSec = Number(reset);
    if (Number.isFinite(resetSec) && resetSec > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const diff = resetSec - nowSec;
      if (diff > 0) return Math.min(60 * 60, Math.ceil(diff));
    }
  }

  return null;
}

export async function POST(req: Request) {
  const token = await getCookie("x_access_token");

  // 未連携（cookieなし）
  if (!token) {
    return NextResponse.json(
      {
        error: "NOT_CONNECTED",
        message: "Xが未連携です。連携してください。",
        connectUrl: CONNECT_URL,
      },
      { status: 401 }
    );
  }

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "本文が不正です。", details: body.error.flatten() },
      { status: 400 }
    );
  }

  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: body.data.text }),
  });

  const { json, rawText } = await readResponse(res);

  if (!res.ok) {
    const detailStr = pickDetail(json);

    // ✅ 429 Too Many Requests
    if (res.status === 429) {
      const retryAfter = getRetryAfterSeconds(res) ?? 60;
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: "投稿が多すぎます。しばらく待ってから再度お試しください。",
          retryAfter, // ✅ フロントが秒でカウントダウンできる
          details: json,
          raw: rawText,
        },
        { status: 429 }
      );
    }

    // 認証切れ / 無効トークン
    if (res.status === 401) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "Xの認証が切れました。再連携してください。",
          connectUrl: CONNECT_URL,
          shouldDisconnect: true,
          details: json,
          raw: rawText,
        },
        { status: 401 }
      );
    }

    // duplicate content（Xは403で返すことが多い）
    if (res.status === 403 && /duplicate content/i.test(detailStr)) {
      return NextResponse.json(
        {
          error: "DUPLICATE_TWEET",
          message: "同じ内容の投稿はできません。少し内容を変えて投稿してください。",
          details: json,
          raw: rawText,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: "X_API_ERROR",
        message: detailStr || "X API error",
        details: json,
        raw: rawText,
      },
      { status: res.status }
    );
  }

  return NextResponse.json(json);
}
