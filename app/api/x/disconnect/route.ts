import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });

  // x_access_token を削除（path は cookie を付けた時と合わせる。迷ったら "/"）
  res.cookies.set("x_access_token", "", {
    path: "/",
    maxAge: 0,
  });

  // もしリフレッシュトークン等も持ってるなら一緒に消す
  res.cookies.set("x_refresh_token", "", {
    path: "/",
    maxAge: 0,
  });

  return res;
}
