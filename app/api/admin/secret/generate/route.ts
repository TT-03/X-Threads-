import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import crypto from "crypto";

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const secret = crypto.randomBytes(24).toString("hex");
  return NextResponse.json({ secret });
}
