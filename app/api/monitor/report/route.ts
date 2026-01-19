import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendAlertEmail } from "../../../../lib/alertEmail";

export const runtime = "nodejs";

// ===== 共通：Cron認証（Authorization: Bearer <CRON_SECRET>） =====
function requireCron(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

  const secret = process.env.CRON_SECRET || "";
  if (!secret || token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// ===== Supabase admin client =====
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ===== 抑制（デデュープ） =====
function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function getDedupeMinutes(kind: "report" | "monitor") {
  // 同じ内容を送らない時間（分）
  // 例: Vercel Env に ALERT_DEDUPE_REPORT_MINUTES=30, ALERT_DEDUPE_MONITOR_MINUTES=60 など
  const fallback = kind === "monitor" ? 60 : 30;
  const key =
    kind === "monitor" ? "ALERT_DEDUPE_MONITOR_MINUTES" : "ALERT_DEDUPE_REPORT_MINUTES";
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function sendAlertOnce(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  params: { kind: "report" | "monitor"; subject: string; text: string; dedupeKey: string }
) {
  const minutes = getDedupeMinutes(params.kind);
  const windowMs = minutes * 60 * 1000;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 既存取得
  const existing = await supabase
    .from("alert_dedupe")
    .select("alert_key,last_sent_at,sent_count")
    .eq("alert_key", params.dedupeKey)
    .maybeSingle();

  if (existing.error) {
    // デデュープテーブルが読めない等でも「通知は落とさない」方針で送る
    await sendAlertEmail(params.subject, params.text);
    return { ok: true, sent: true, suppressed: false, reason: "dedupe_read_failed" };
  }

  const lastSentAt = existing.data?.last_sent_at
    ? new Date(existing.data.last_sent_at).getTime()
    : 0;

  const withinWindow = lastSentAt > 0 && now - lastSentAt < windowMs;

  // 送信履歴を upsert（回数もカウント）
  const nextCount = (existing.data?.sent_count ?? 0) + 1;

  if (withinWindow) {
    // 抑制：last_sent_at は更新しない（ウィンドウ延長を防ぐ）
    await supabase
      .from("alert_dedupe")
      .upsert(
        {
          alert_key: params.dedupeKey,
          last_sent_at: existing.data!.last_sent_at,
          sent_count: nextCount,
          last_subject: params.subject,
          last_body: params.text.slice(0, 2000),
          updated_at: nowIso,
        },
        { onConflict: "alert_key" }
      );

    return { ok: true, sent: false, suppressed: true, dedupeMinutes: minutes };
  }

  // 送る：last_sent_at を更新
  await supabase
    .from("alert_dedupe")
    .upsert(
      {
        alert_key: params.dedupeKey,
        last_sent_at: nowIso,
        sent_count: nextCount,
        last_subject: params.subject,
        last_body: params.text.slice(0, 2000),
        updated_at: nowIso,
      },
      { onConflict: "alert_key" }
    );

  await sendAlertEmail(params.subject, params.text);
  return { ok: true, sent: true, suppressed: false, dedupeMinutes: minutes };
}

export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  const body: any = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();

  // 3) 「エラーレポート」モード（run_schedule.sh などからPOSTされる）
  if (typeof body?.status === "number" && typeof body?.url === "string") {
    const status = body.status;
    const url = body.url;
    const responseText = String(body?.responseText ?? "");

    const subject = `[X-Threads] Cron error: ${status} (report)`;
    const text =
      `Cronが失敗しました。\n\n` +
      `Status: ${status}\nURL: ${url}\n\n` +
      `Response:\n${responseText}`;

    // 同一内容キー（status+url+responseText）で抑制
    const dedupeKey = `report:${sha256(`${status}|${url}|${responseText}`)}`;

    const r = await sendAlertOnce(supabase, {
      kind: "report",
      subject,
      text,
      dedupeKey,
    });

    return NextResponse.json({ ok: true, mode: "error-report", ...r });
  }

  // 4) 「モニター」モード
  try {
    const now = Date.now();
    const since15m = new Date(now - 15 * 60 * 1000).toISOString();
    const before2m = new Date(now - 2 * 60 * 1000).toISOString();

    // A) 直近15分で failed / auth_required
    const badStatuses = ["failed", "auth_required"];
    const bad = await supabase
      .from("scheduled_posts")
      .select("id, provider, status, run_at, updated_at, last_error, group_id")
      .in("status", badStatuses)
      .gte("updated_at", since15m)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (bad.error) {
      return NextResponse.json(
        { ok: false, mode: "monitor", error: bad.error.message },
        { status: 500 }
      );
    }

    // B) run_at を2分過ぎても pending のまま
    const stuck = await supabase
      .from("scheduled_posts")
      .select("id, provider, status, run_at, updated_at, last_error, group_id")
      .eq("status", "pending")
      .lte("run_at", before2m)
      .order("run_at", { ascending: true })
      .limit(20);

    if (stuck.error) {
      return NextResponse.json(
        { ok: false, mode: "monitor", error: stuck.error.message },
        { status: 500 }
      );
    }

    const alerts: any[] = [];
    if ((bad.data ?? []).length > 0) alerts.push({ type: "bad_status", rows: bad.data });
    if ((stuck.data ?? []).length > 0) alerts.push({ type: "stuck_pending", rows: stuck.data });

    if (alerts.length === 0) {
      return NextResponse.json({ mode: "monitor", alerts: alerts.length, ...r });

    }

    // メール本文
    const lines: string[] = [];
    lines.push("モニターで異常を検知しました。\n");
    for (const a of alerts) {
      lines.push(a.type === "bad_status" ? "=== failed / auth_required (直近15分) ===" : "=== pending が2分以上残留 ===");
      for (const r of a.rows) {
        lines.push(
          `- id=${r.id} provider=${r.provider} status=${r.status} run_at=${r.run_at} updated_at=${r.updated_at} group_id=${r.group_id ?? ""}`
        );
        if (r.last_error) lines.push(`  last_error=${String(r.last_error).slice(0, 300)}`);
      }
      lines.push("");
    }

    const subject = `[X-Threads] Monitor alert (${alerts.reduce((n, a) => n + a.rows.length, 0)})`;
    const text = lines.join("\n");

    // “同じアラート内容” を抑制（ids まで含めてハッシュ）
    const dedupeKey = `monitor:${sha256(JSON.stringify(alerts))}`;

    const r = await sendAlertOnce(supabase, {
      kind: "monitor",
      subject,
      text,
      dedupeKey,
    });

    return NextResponse.json({ mode: "error-report", ...r });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, mode: "monitor", error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
