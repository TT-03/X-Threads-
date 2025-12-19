import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";

export async function GET() {
  const token = await getCookie("x_access_token");

  // MVP: Cookieがあれば「連携中」とみなす（厳密チェックは後でOK）
  return NextResponse.json({
    connected: Boolean(token),
  });
}
