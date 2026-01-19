import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const base = process.env.NEXT_PUBLIC_APP_URL; // 例: https://x-threads-roan.vercel.app
  const cronSecret = process.env.CRON_SECRET;
  if (!base || !cronSecret) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  const res = await fetch(`${base}/api/schedule/run`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });

  const text = await res.text();
  return NextResponse.json({ ok: res.ok, status: res.status, body: text });
}
