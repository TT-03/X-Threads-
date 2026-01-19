import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export async function POST(req: Request) {
  // 1) 認証
  const denied = requireCron(req);
  if (denied) return denied;

  // 2) body（無い/壊れててもOK）
  const body: any = await req.json().catch(() => ({}));

  // 3) 「エラーレポート」モード：run_schedule.sh から送られてくるやつ
  //    例: { status: 401, url:"/api/schedule/run", responseText:"..." }
  if (typeof body?.status === "number" && typeof body?.url === "string") {
    const status = body.status;
    const url = body.url;
    const responseText = String(body?.responseText ?? "");

    const subject = `[X-Threads] Cron error: ${status} (report)`;
    const text = `Cronが失敗しました。\n\nStatus: ${status}\nURL: ${url}\n\nResponse:\n${responseText}`;

    await sendAlertEmail(subject, text);
    return NextResponse.json({ ok: true, mode: "error-report" });
  }

  // 4) 「モニター」モード：定期チェック（*/5 など）
  try {
    const supabase = getSupabaseAdmin();

    const now = Date.now();
    const since15m = new Date(now - 15 * 60 * 1000).toISOString();
    const before2m = new Date(now - 2 * 60 * 1000).toISOString();

    // A) 直近15分で failed / auth_required になったもの
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

    // B) 予定時刻を2分過ぎても pending のまま（Cron停止/遅延の疑い）
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

    // 何も無ければOK
    if (alerts.length === 0) {
      return NextResponse.json({ ok: true, mode: "monitor", alerts: 0 });
    }

    // メール本文を作る
    const lines: string[] = [];
    lines.push("モニターで異常を検知しました。\n");

    for (const a of alerts) {
      if (a.type === "bad_status") {
        lines.push("=== failed / auth_required (直近15分) ===");
      } else {
        lines.push("=== pending が2分以上残留 ===");
      }

      for (const r of a.rows) {
        lines.push(
          `- id=${r.id} provider=${r.provider} status=${r.status} run_at=${r.run_at} updated_at=${r.updated_at} group_id=${r.group_id ?? ""}`
        );
        if (r.last_error) lines.push(`  last_error=${String(r.last_error).slice(0, 300)}`);
      }
      lines.push("");
    }

    const subject = `[X-Threads] Monitor alert (${alerts.reduce((n, a) => n + a.rows.length, 0)})`;
    await sendAlertEmail(subject, lines.join("\n"));

    return NextResponse.json({ ok: true, mode: "monitor", alerts: alerts.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, mode: "monitor", error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
