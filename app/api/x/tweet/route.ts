import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookie } from "../../_lib/cookies";

const Body = z.object({
  text: z.string().min(1).max(10000),
});

function pickDetail(json: any) {
  if (typeof json?.detail === "string") return json.detail;
  if (typeof json?.errors?.[0]?.message === "string") return json.errors[0].message;
  if (typeof json?.title === "string") return json.title;
  return "";
}

export async function POST(req: Request) {
  const token = await getCookie("x_access_token");

  // 未連携（cookieなし）
  if (!token) {
    return NextResponse.json(
      {
        error: "NOT_CONNECTED",
        message: "Xが未連携です。連携してください。",
        connectUrl: "/accounts",
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

  const json = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    const detailStr = pickDetail(json);

    // 認証切れ / 無効トークン（cookieはあるがXが401）
    if (res.status === 401) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "Xの認証が切れました。再連携してください。",
          connectUrl: "/accounts",
          details: json,
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
      },
      { status: res.status }
    );
  }

  return NextResponse.json(json);
}
