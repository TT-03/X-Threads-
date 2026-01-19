import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendAlertEmail } from "../../../../lib/alertEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5分間は同じ内容を送らない（簡易スパム防止）
let lastSentAt = 0;
let lastDigest = "";

function makeDigest(rows: any[]) {
  return rows
    .map((r) => `${r.id}:${r.status}:${r.updated_at}:${r.attempts ?? ""}`)
    .join("|");
}

export async function POST(req: Request) {
  // --- 認証（CRON_SECRET） ---
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- 1) Oracleからの「即時エラー通報」(既存機能) ---
  // bodyがあれば：その内容をメール
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null; // bodyなし（監視cron）でもOK
  }

  if (body && (body.status || body.url || body.responseText)) {
    const subject = `[X-Threads] Cron error: ${body?.status ?? "unknown"}`;
    const text =
      `Cron failed.\n` +
      `status: ${body?.status}\n` +
      `url: ${body?.url}\n` +
      `body:\n${body?.responseText ?? ""}\n`;

    await sendAlertEmail(subject, text);
    return NextResponse.json({ ok: true, mode: "report" });
  }

  // --- 2) DB監視（scheduled_posts の failed/auth_required をチェック） ---
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Missing SUPABASE env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 「直近10分で更新された異常」を拾う（連続メールを減らすため）
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("id,provider,status,run_at,updated_at,attempts,last_error,group_id")
    .in("status", ["failed", "auth_required"])
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    await sendAlertEmail("[X-Threads] Monitor DB error", String(error.message ?? error));
    return NextResponse.json({ ok: false, mode: "monitor", error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, mode: "monitor", alerts: 0 });
  }

  // 簡易スパム防止（5分以内＋同内容なら送らない）
  const digest = makeDigest(rows);
  const now = Date.now();
  if (digest === lastDigest && now - lastSentAt < 5 * 60 * 1000) {
    return NextResponse.json({ ok: true, mode: "monitor", alerts: rows.length, skipped: true });
  }
  lastDigest = digest;
  lastSentAt = now;

  const subject = `[X-Threads] Alert: ${rows.length} issue(s)`;
  const text =
    `scheduled_posts に異常があります（直近10分の更新分）\n\n` +
    rows
      .map((r) => {
        const err = (r.last_error ?? "").toString().slice(0, 200);
        return `- ${r.status} / ${r.provider} / id=${r.id} / updated_at=${r.updated_at} / run_at=${r.run_at} / attempts=${r.attempts ?? ""}\n  error=${err}`;
      })
      .join("\n");

  await sendAlertEmail(subject, text);
  return NextResponse.json({ ok: true, mode: "monitor", alerts: rows.length })
