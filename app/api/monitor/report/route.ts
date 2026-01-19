import { NextResponse } from "next/server";
import { sendAlertEmail } from "../../../../lib/alertEmail";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const subject = `[X-Threads] Cron error: ${body?.status ?? "unknown"}`;
  const text =
    `Cron failed.\n` +
    `status: ${body?.status}\n` +
    `url: ${body?.url}\n` +
    `body:\n${body?.responseText ?? ""}\n`;

  await sendAlertEmail(subject, text);
  return NextResponse.json({ ok: true });
}
