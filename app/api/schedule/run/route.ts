import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";
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

export async function POST() {
  // 1) サーバー側で user_id を取得（OAuth callback で入れた HttpOnly cookie）
  const userId = await getCookie("x_user_id");
  if (!userId) {
    return NextResponse.json({ error: "Missing cookie: x_user_id (連携し直してください)" }, { status: 401 });
  }

  // 2) Supabase Admin（service role）でDB操作
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }
  const supabase = getSupabaseAdmin();

  // 3) 期限到来の pending を1件だけ拾う（まずは最短確認用に1件）
  const nowIso = new Date().toISOString();
  const { data: rows, error: selErr } = await supabase
    .from("scheduled_posts")
    .select("id,user_id,provider,text,run_at,status,attempts")
    .eq("user_id", userId)
    .eq("provider", "x")
    .eq("status", "pending")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(1);

  if (selErr) {
    return NextResponse.json({ error: "Failed to select scheduled_posts", details: selErr }, { status: 500 });
  }
  const post = (rows?.[0] as ScheduledPost | undefined);
  if (!post) {
    return NextResponse.json({ ok: true, message: "実行対象なし（pendingでrun_at<=nowがありません）" });
  }

  // 4) 二重実行防止：pending→running に更新（status一致条件つき）
  const { data: lockRows, error: lockErr } = await supabase
    .from("scheduled_posts")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", post.id)
    .eq("status", "pending")
    .select("id");

  if (lockErr) {
    return NextResponse.json({ error: "Failed to lock scheduled_posts", details: lockErr }, { status: 500 });
  }
  if (!lockRows || lockRows.length === 0) {
    return NextResponse.json({ ok: true, message: "他で処理中でした（ロック取得できず）" });
  }

  // 5) x_tokens からアクセストークン取得
  const { data: tok, error: tokErr } = await supabase
    .from("x_tokens")
    .select("access_token")
    .eq("user_id", userId)
    .single();

  if (tokErr || !tok?.access_token) {
    // running を failed に戻す
    await supabase
      .from("scheduled_posts")
      .update({
        status: "failed",
        attempts: (post.attempts ?? 0) + 1,
        last_error: "Missing access_token in x_tokens",
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);

    return NextResponse.json({ error: "Missing access_token in x_tokens", details: tokErr }, { status: 500 });
  }

  // 6) Xに投稿
  const r = await postToX(tok.access_token, post.text);

  if (!r.ok) {
    await supabase
      .from("scheduled_posts")
      .update({
        status: "failed",
        attempts: (post.attempts ?? 0) + 1,
        last_error: `X post failed (${r.status}): ${JSON.stringify(r.json)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);

    return NextResponse.json({ error: "X post failed", status: r.status, details: r.json }, { status: 400 });
  }

  const tweetId = r.json?.data?.id ?? null;

  // 7) sent に更新
  await supabase
    .from("scheduled_posts")
    .update({
      status: "sent",
      tweet_id: tweetId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", post.id);

  return NextResponse.json({ ok: true, message: "予約を実行して投稿しました", scheduled_post_id: post.id, tweet_id: tweetId });
}
