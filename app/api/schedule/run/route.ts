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

// ✅ GETでもPOSTでも動く（Vercel CronはGETが多い）
export async function GET(req: Request) {
  try {
    assertCron(req); // ✅ ★ここ
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runOnce(); // ← POST() じゃなく runOnce を直接呼ぶのがスッキリ
}

export async function POST(req: Request) {
  // 手動実行も保護したいならここにも assertCron(req) を入れる
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

  // ✅ 期限到来の pending を最大10件拾う（全ユーザー対象）
  const { data: rows, error: selErr } = await supabase
    .from("scheduled_posts")
    .select("id,user_id,provider,text,run_at,status,attempts")
    .eq("provider", "x")
    .eq("status", "pending")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(10);

  if (selErr) {
    return NextResponse.json({ error: "Failed to select scheduled_posts", details: selErr }, { status: 500 });
  }

  const jobs = (rows ?? []) as ScheduledPost[];
  if (jobs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0, message: "実行対象なし" });
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;

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
      // 他で処理中 or 更新失敗
      continue;
    }

    // ② トークン取得（user_idごと）
    const { data: tok, error: tokErr } = await supabase
      .from("x_tokens")
      .select("access_token")
      .eq("user_id", job.user_id)
      .single();

    if (tokErr || !tok?.access_token) {
      await supabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          attempts: (job.attempts ?? 0) + 1,
          last_error: "Missing access_token in x_tokens",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      failed++;
      continue;
    }

    // ③ 投稿
    const r = await postToX(tok.access_token, job.text);

    if (!r.ok) {
      // 401は認証切れ（再連携必要）→ failedで止める
      // 429などは本当はリトライしたいが、MVPは failed にして原因を見る
      await supabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          attempts: (job.attempts ?? 0) + 1,
          last_error: `X post failed (${r.status}): ${JSON.stringify(r.json)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      failed++;
      continue;
    }

    const tweetId = r.json?.data?.id ?? null;

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
  }

  return NextResponse.json({ ok: true, processed, sent, failed });
}
