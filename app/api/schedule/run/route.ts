import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScheduledPost = {
  id: string;
  user_id: string;
  provider: string;
  text: string;
  run_at: string;
  status: string;
  attempts: number | null;
};

type JobResult = {
  id: string;
  action: "sent" | "failed" | "skipped";
  tweetId?: string | null;
  error?: string;
};

function requireCronAuth(req: Request) {
  const secret = process.env.CRON_SECRET;

  // 本番で未設定は危険なので止める（ローカルは未設定でも動かせる）
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Missing env: CRON_SECRET" }, { status: 500 });
    }
    return null;
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function postToX(accessToken: string, text: string) {
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// ✅ Cron は GET で呼ぶので GET を本命にする
export async function GET(req: Request) {
  const guard = requireCronAuth(req);
  if (guard) return guard;
  return runOnce();
}

// 手動実行などで POST も許可したい場合
export async function POST(req: Request) {
  const guard = requireCronAuth(req);
  if (guard) return guard;
  return runOnce();
}

async function runOnce() {
  // サーバー環境変数チェック
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // ✅ 期限到来の pending を最大10件拾う
  const { data: rows, error: selErr } = await supabase
    .from("scheduled_posts")
    .select("id,user_id,provider,text,run_at,status,attempts")
    .eq("provider", "x")
    .eq("status", "pending")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(10);

  if (selErr) {
    return NextResponse.json(
      { error: "Failed to select scheduled_posts", details: selErr },
      { status: 500 }
    );
  }

  const jobs = (rows ?? []) as ScheduledPost[];
  if (jobs.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      sent: 0,
      failed: 0,
      results: [],
      message: "実行対象なし",
    });
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const results: JobResult[] = [];

  for (const job of jobs) {
    processed++;

    // ① ロック：pending→running（二重実行防止）
    const { data: lockRows, error: lockErr } = await supabase
      .from("scheduled_posts")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id");

    if (lockErr || !lockRows || lockRows.length === 0) {
      results.push({ id: job.id, action: "skipped", error: "lock failed or already running" });
      continue;
    }

    // ② トークン取得
    const { data: tok, error: tokErr } = await supabase
      .from("x_tokens")
      .select("access_token")
      .eq("user_id", job.user_id)
      .single();

    if (tokErr || !tok?.access_token) {
      const errMsg = "Missing access_token in x_tokens";
      await supabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          attempts: (job.attempts ?? 0) + 1,
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      failed++;
      results.push({ id: job.id, action: "failed", error: errMsg });
      continue;
    }

    // ③ 投稿
    const r = await postToX(tok.access_token, job.text);

    if (!r.ok) {
      const errMsg = `X post failed (${r.status}): ${JSON.stringify(r.json)}`;

      await supabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          attempts: (job.attempts ?? 0) + 1,
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      failed++;
      results.push({ id: job.id, action: "failed", error: errMsg });
      continue;
    }

    const tweetId = (r.json?.data?.id as string | undefined) ?? null;

    // ④ sent に更新
    await supabase
      .from("scheduled_posts")
      .update({
        status: "sent",
        tweet_id: tweetId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    sent++;
    results.push({ id: job.id, action: "sent", tweetId });
  }

  return NextResponse.json({ ok: true, processed, sent, failed, results });
}
