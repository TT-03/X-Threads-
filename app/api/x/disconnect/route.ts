import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });

  // 連携情報をCookieで持っている前提：削除
  res.cookies.delete("x_access_token");
  res.cookies.delete("x_refresh_token"); // 使っていれば
  res.cookies.delete("x_user_id");       // 使っていれば

  return res;
}
