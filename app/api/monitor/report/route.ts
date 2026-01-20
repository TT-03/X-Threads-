import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendAlertEmail } from "@/lib/alertEmail";

export const runtime = "nodejs";

type ErrorReportBody = {
  status: number;
  url: string;
  responseText?: string;
};

function json(status: number, data: any) {
  return NextResponse.json(data, { status });
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

function sha256(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function nowMs() {
  return Date.now();
}

function minutesToMs(min: number) {
  return min * 60 * 1000;
}

function safeStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function normalizeForSignature(body: ErrorReportBody) {
  const resp = safeStr(body.responseText)
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return `${body.status}|${body.url}|${resp}`;
}

function buildEmailText(kind: "monitor" | "report", payload: any) {
  if (kind === "report") {
    const b = payload as ErrorReportBody;
    const resp = safeStr(b.responseText).slice(0, 4000);
    return [
      "Cronが失敗しました。",
      "",
      `Status: ${b.status}`,
      `URL: ${b.url}`,
      "",
      "Response:",
      resp || "(empty)",
    ].join("\n");
  }

  const items: string[] = payload.items || [];
  return ["モニター検知:", "", ...items, "", `checkedAt: ${new Date().toISOString()}`].join("\n");
}

function buildSubject(kind: "monitor" | "report", title: string) {
  return kind === "report"
    ? `[X-Threads] Cron error: ${title} (report)`
    : `[X-Threads] Cron error: ${title} (monitor)`;
}

async function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * 同じ内容のメールを一定時間抑制するためのDBテーブル:
 *   alert_dedupe(signature text primary key, last_sent_at timestamptz)
 */
async function shouldSendByDedupe(signature: string, suppressMinutes: number) {
  const supabase = await getSupabaseAdmin();

  const { data, error } = await supabase
    .from("alert_dedupe")
    .select("signature,last_sent_at")
    .eq("signature", signature)
    .maybeSingle();

  // テーブル未作成などでも「とりあえず送れる」ように落とさない
  if (error) {
    return { ok: true as const, reason: "dedupe_table_error", detail: error.message };
  }

  if (data?.last_sent_at) {
    const last = new Date(data.last_sent_at).getTime();
    if (!Number.isNaN(last) && nowMs() - last < minutesToMs(suppressMinutes)) {
      return { ok: false as const, reason: "suppressed" };
    }
  }

  const { error: upsertErr } = await supabase
    .from("alert_dedupe")
    .upsert({ signature, last_sent_at: new Date().toISOString() }, { onConflict: "signature" });

  if (upsertErr) {
    return { ok: true as const, reason: "upsert_failed", detail: upsertErr.message };
  }

  return { ok: true as const, reason: "send" };
}

// ===== ここから monitor（scheduled_posts 実スキーマ対応） =====
// scheduled_posts columns:
// id, user_id, provider, text, run_at, status, attempts, last_error, tweet_id,
// created_at, updated_at, group_id, draft_id, provider_post_id, target_url

function pickProvider(r: any) {
  return r?.provider ?? "(unknown)";
}

function pickLastError(r: any) {
  return r?.last_error ?? "";
}

async function handleMonitor() {
  const supabase = await getSupabaseAdmin();

  // 監視しきい値（分）：Vercel環境変数で調整
  const PENDING_STALE_MINUTES = Number(process.env.MONITOR_PENDING_STALE_MINUTES || "10") || 10;
  const RUNNING_STALE_MINUTES = Number(process.env.MONITOR_RUNNING_STALE_MINUTES || "30") || 30;

  const now = Date.now();
  const pendingCutoffIso = new Date(now - PENDING_STALE_MINUTES * 60 * 1000).toISOString();
  const runningCutoffIso = new Date(now - RUNNING_STALE_MINUTES * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const items: string[] = [];

  // 1) 取りこぼし疑い（run_atが古いのに pending）
  {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("status", "pending")
      .lt("run_at", pendingCutoffIso)
      .order("run_at", { ascending: true })
      .limit(20);

    if (error) throw new Error(`monitor pending query failed: ${error.message}`);

    if (data && data.length > 0) {
      items.push(`【遅延】pending が run_at から${PENDING_STALE_MINUTES}分以上経過: ${data.length}件`);
      for (const r of data as any[]) {
        const text = String(r?.text || "").slice(0, 60);
        items.push(`- id=${r?.id} provider=${pickProvider(r)} run_at=${r?.run_at} text=${text}`);
      }
    }
  }

  // 2) ユーザー対応待ち（Threads想定：needs_user_action）
  {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("status", "needs_user_action")
      .order("run_at", { ascending: true })
      .limit(20);

    if (error) throw new Error(`monitor needs_user_action query failed: ${error.message}`);

    if (data && data.length > 0) {
      items.push(`【要対応】needs_user_action: ${data.length}件`);
      for (const r of data as any[]) {
        const text = String(r?.text || "").slice(0, 60);
        items.push(`- id=${r?.id} provider=${pickProvider(r)} run_at=${r?.run_at} text=${text}`);
      }
    }
  }

  // 3) failed（last_error を表示）
  {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("status", "failed")
      .order("run_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(`monitor failed query failed: ${error.message}`);

    if (data && data.length > 0) {
      items.push(`【失敗】failed: ${data.length}件`);
      for (const r of data as any[]) {
        const err = String(pickLastError(r)).slice(0, 140);
        items.push(`- id=${r?.id} provider=${pickProvider(r)} run_at=${r?.run_at} err=${err}`);
      }
    }
  }

  // 4) running が固まってる疑い（updated_at が一定時間更新されていない）
  {
    const { data, error } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("status", "running")
      .lt("updated_at", runningCutoffIso)
      .order("updated_at", { ascending: true })
      .limit(20);

    if (error) throw new Error(`monitor running query failed: ${error.message}`);

    if (data && data.length > 0) {
      items.push(`【停滞】running が updated_at から${RUNNING_STALE_MINUTES}分以上更新なし: ${data.length}件`);
      for (const r of data as any[]) {
        const text = String(r?.text || "").slice(0, 60);
        items.push(`- id=${r?.id} provider=${pickProvider(r)} updated_at=${r?.updated_at} text=${text}`);
      }
    }
  }

// 5) 想定外status（漏れ防止）
{
  const known = ["pending", "needs_user_action", "failed", "running", "sent"];
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .not("status", "in", `(${known.map((s) => `"${s}"`).join(",")})`)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`monitor unknown status query failed: ${error.message}`);

  if (data && data.length > 0) {
    items.push(`【要確認】想定外status: ${data.length}件`);
    for (const r of data as any[]) {
      items.push(`- id=${r?.id} provider=${pickProvider(r)} status=${r?.status} updated_at=${r?.updated_at}`);
    }
  }
}

  return { items, checkedAt: nowIso };
}

// ===== monitor ここまで =====

export async function POST(req: Request) {
  // 1) 認証
  const expected = process.env.CRON_SECRET || "";
  const got = getBearer(req);
  if (!expected || got !== expected) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  // 2) 抑制時間（分）: 環境変数が無ければ 30分
  const suppressMinutes = Number(process.env.ALERT_SUPPRESS_MINUTES || "30") || 30;

  // 3) body があるなら「report」、無い/空なら「monitor」
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // ----------------------
  // A) エラー報告モード（Oracleが status/url/responseText を投げる）
  // ----------------------
  if (body && typeof body === "object" && typeof body.status === "number" && typeof body.url === "string") {
    const b: ErrorReportBody = {
      status: body.status,
      url: body.url,
      responseText: typeof body.responseText === "string" ? body.responseText : "",
    };

    const signature = sha256(`report:${normalizeForSignature(b)}`);

    const dedupe = await shouldSendByDedupe(signature, suppressMinutes);
    if (!dedupe.ok) {
      return json(200, { ok: true, mode: "error-report", suppressed: true, suppressMinutes });
    }

    const subject = buildSubject("report", String(b.status));
    const text = buildEmailText("report", b);

    await sendAlertEmail(subject, text);

    return json(200, { ok: true, mode: "error-report", suppressed: false });
  }

  // ----------------------
  // B) モニターモード（5分おきに叩くやつ）
  // ----------------------
  try {
    const result = await handleMonitor();
    const hasAlerts = (result.items || []).length > 0;

    if (!hasAlerts) {
      return json(200, { ok: true, mode: "monitor", alerts: 0 });
    }

    // 同じ一覧が続く場合は抑制
    const signature = sha256(`monitor:${result.items.join("\n")}`);

    const dedupe = await shouldSendByDedupe(signature, suppressMinutes);
    if (!dedupe.ok) {
      return json(200, {
        ok: true,
        mode: "monitor",
        alerts: result.items.length,
        suppressed: true,
        suppressMinutes,
      });
    }

    const subject = buildSubject("monitor", String(result.items.length));
    const text = buildEmailText("monitor", result);

    await sendAlertEmail(subject, text);

    return json(200, { ok: true, mode: "monitor", alerts: result.items.length, suppressed: false });
  } catch (e: any) {
    // monitor 側の処理が落ちたら、それ自体を「report」として送る（ただし抑制あり）
    const b: ErrorReportBody = {
      status: 500,
      url: "/api/monitor/report (monitor)",
      responseText: String(e?.message || e),
    };
    const signature = sha256(`report:${normalizeForSignature(b)}`);

    const dedupe = await shouldSendByDedupe(signature, suppressMinutes);
    if (dedupe.ok) {
      const subject = buildSubject("report", "500");
      const text = buildEmailText("report", b);
      await sendAlertEmail(subject, text);
    }

    // 監視の呼び出し自体は 200 で返す（cron側が「APIが落ちた」と誤判定しないため）
    return json(200, { ok: false, mode: "monitor", error: String(e?.message || e) });
  }
}
