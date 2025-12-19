import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";

export async function GET() {
  const token = await getCookie("x_access_token");
  return NextResponse.json({
    connected: Boolean(token),
  });
}
