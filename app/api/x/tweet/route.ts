import { NextResponse } from "next/server";
import { z } from "zod";
import { getCookie } from "../../_lib/cookies";

const Body = z.object({
  text: z.string().min(1).max(10000),
});

export async function POST(req: Request) {
  const token = await getCookie("x_access_token");
  if (!token) {
    return NextResponse.json(
      { error: "Not connected to X.", connectUrl: "/accounts" },
      { status: 401 }
    );
  }

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid body", details: body.error.flatten() },
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
    const detailStr =
      typeof (json as any)?.detail === "string"
        ? (json as any).detail
        : typeof (json as any)?.errors?.[0]?.message === "string"
          ? (json as any).errors[0].message
          : "";

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

    return NextResponse.json(
      { error: "X API error", details: json },
      { status: res.status }
    );
  }

  return NextResponse.json(json);
}
