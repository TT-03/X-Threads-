import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAlertEmail } from "../../../../lib/alertEmail";

const BAD_STATUSES = ["failed", "auth_required", "needs_user_action"] as const;

export async function POST(req: Request) {
  // --- auth ---
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- body を「安全に」読む（空なら monitor モード）---
  const raw = await req.text();
  const body = raw ? safeJsonParse(raw) : null;

  // =========================
  // A) error-report モード（Oracle側が status/url/responseText を投げる）
  // =========================
  if (body && typeof body === "object" && ("status" in body || "url" in body)) {
    const status = (body as any)?.status ?? "unknown";
    const url = (body as any)?.url ?? "unknown";
    const responseText = (body as any)?.responseText ?? "";

    const subject = `[X-Threads] Cron error: ${status} (monitor)`;
    const text =
      `Cron failed.\n` +
      `status: ${status}\n` +
      `url: ${url}\n` +
      `body:\n${responseText}\n`;

    await sendAlertEmail(subject, text);
    return NextResponse.json({ ok: true, mode: "error-report" });
  }

  // =========================
  // B) monitor モード（bodyなしで叩かれたら、Queue異常をチェック）
  // =========================
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    // 環境変数不足も「異常」なのでメール
    await sendAlertEmail(
      "[X-Threads] Monitor misconfig",
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    return NextResponse.json(
      { ok: false, mode: "monitor", error: "Missing supabase env" },
      { status: 500 }
    );
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // 直近6時間の run_at を対象（スパム減らすため）
  const now = Date.now();
  const sinceIso = new Date(now - 6 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("scheduled_posts")
    .select("id, status, run_at, text, group_id, created_at")
    .in("status", [...BAD_STATUSES])
    .gte("run_at", sinceIso)
    .order("run_at", { ascending: false })
    .limit(30);

  if (error) {
    await sendAlertEmail(
      "[X-Threads] Monitor query failed",
      `Supabase query error:\n${error.message}`
    );
    return NextResponse.json(
      { ok: false, mode: "monitor", error: error.message },
      { status: 500 }
    );
  }

  const alerts = data ?? [];

  if (alerts.length > 0) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const queueUrl = appUrl ? `${appUrl.replace(/\/$/, "")}/queue` : "(no NEXT_PUBLIC_APP_URL)";

    const lines = alerts.map((p) => {
      const when = p.run_at ? new Date(p.run_at).toLocaleString("ja-JP") : "no run_at";
      const title = (p.text ?? "").slice(0, 60).replace(/\n/g, " ");
      return `- [${p.status}] ${when} id=${p.id} ${title}`;

    const subject = `[X-Threads] Queue alerts: ${alerts.length}`;
    const text =
      `Queueに異常があります（直近6時間）\n` +
      `対象ステータス: ${BAD_STATUSES.join(", ")}\n` +
      `Queue: ${queueUrl}\n\n` +
      lines.join("\n") +
      `\n`;

    await sendAlertEmail(subject, text);
  }

  return NextResponse.json({ ok: true, mode: "monitor", alerts: alerts.length });
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
