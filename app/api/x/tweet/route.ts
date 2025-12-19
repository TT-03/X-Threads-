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
    return NextResponse.json({ error: "Invalid body", details: body.error.flatten() }, { status: 400 });
  }

  // MVP: No media, no reply threads. Just a plain post.
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ text: body.data.text }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: "X API error", details: json }, { status: 400 });
  }

  return NextResponse.json(json);
}
