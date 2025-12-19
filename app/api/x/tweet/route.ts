import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookie } from "../../_lib/cookies";

const CONNECT_URL = "/accounts"; // ← ここだけ変えればOKにする

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

    // 認証切れ / 無効トークン（cookieはあるがXが401）
    if (res.status === 401) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "Xの認証が切れました。再連携してください。",
          connectUrl: CONNECT_URL,

          // ★フロントで「未連携表示」に戻すためのヒント（任意だけど便利）
          shouldDisconnect: true,

          details: json,
          raw: rawText, // JSONじゃない時のデバッグ用
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
        },
        { status: 409 }
      );
    }

    // その他
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

  // 成功
  return NextResponse.json(json);
}
