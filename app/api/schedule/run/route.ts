import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";
import { decryptText } from "@/lib/crypto";

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
  action: "sent" | "failed" | "skipped" | "needs_user_action";
  tweetId?: string | null;
  error?: string;
};

type XConnection = {
  user_id: string;
  x_client_id: string;
  x_client_secret_enc: string;
  x_scopes: string;
  x_access_token: string | null;
  x_refresh_token: string | null;
  x_expires_at: string | null;
};

function clampError(s: string, max = 1500) {
  return s.length > max ? s.slice(0, max) : s;
}

// ✅ リトライ運用の最小ルール
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;

function bumpRunAtFromNow() {
  return new Date(Date.now() + RETRY_DELAY_MS).toISOString();
}

function isRetryableHttpStatus(status: number) {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

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

async function getXConnection(supabase: any, userId: string): Promise<XConnection | null> {
  const { data, error } = await supabase
    .from("x_connections")
    .select(
      "user_id,x_client_id,x_client_secret_enc,x_scopes,x_access_token,x_refresh_token,x_expires_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to select x_connections: ${error.message}`);
  return (data ?? null) as XConnection | null;
}

async function refreshXTokenForUser(conn: XConnection) {
  const clientId = conn.x_client_id;
  const clientSecret = decryptText(conn.x_client_secret_enc); // BYOの秘密鍵（暗号化保存）
  const refreshToken = conn.x_refresh_token;

  if (!clientId) return { ok: false, status: 500, json: { error: "Missing x_client_id" } };
  if (!refreshToken) return { ok: false, status: 400, json: { error: "Missing x_refresh_token" } };

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // client_secret を使う構成なら Basic 認証が必要なケースが多い
  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers["Authorization"] = `Basic ${basic}`;
  }

  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function needsRefreshSoon(expiresAtIso: string | null) {
  if (!expiresAtIso) return false; // 不明ならrefreshしない（今の動作を維持）
  const t = new Date(expiresAtIso).getTime();
  if (Number.isNaN(t)) return false;
  return t <= Date.now() + 60 * 1000; // 1分以内に切れるなら更新
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

  // ✅ 期限到来の pending を最大10件拾う（x + threads 両方）
  const { data: rows, error: selErr } = await supabase
    .from("scheduled_posts")
    .select("id,user_id,provider,text,run_at,status,attempts")
    .in("provider", ["x", "threads"])
    .eq("status", "pending")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(10);

  if (selErr) {
    return NextResponse.json({ error: "Failed to select scheduled_posts", details: selErr }, { status: 500 });
  }

  const jobs = (rows ?? []) as ScheduledPost[];
  if (jobs.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      sent: 0,
      failed: 0,
      needs_user_action: 0,
      results: [],
      message: "実行対象なし",
    });
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let needsUserAction = 0;
  const results: JobResult[] = [];

  for (const job of jobs) {
    processed++;

    // ✅ ThreadsはMVPでは自動投稿しない：needs_user_actionへ
    if ((job.provider ?? "").toLowerCase() === "threads") {
      // 二重実行防止のため一旦ロック（pending→running）
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

      await supabase
        .from("scheduled_posts")
        .update({
          status: "needs_user_action",
          last_error: "Threads is notify-mode in MVP (manual assist required).",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      needsUserAction++;
      results.push({ id: job.id, action: "needs_user_action" });
      continue;
    }

    // -------------------------
    // ここから X（ユーザー別トークン / BYO）
    // -------------------------

    // ✅ attempts上限チェック（無限ループ防止）
    const attempts = job.attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      const errMsg = `max attempts reached: ${attempts}`;

      await supabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "pending");

      failed++;
      results.push({ id: job.id, action: "failed", error: errMsg });
      continue;
    }

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

    // ② ユーザー別のX接続情報を取得
    let conn: XConnection | null = null;
    try {
      conn = await getXConnection(supabase, job.user_id);
    } catch (e: any) {
      const errMsg = clampError(`Failed to load x_connection: ${String(e?.message ?? e)}`);

      await supabase
        .from("scheduled_posts")
        .update({
          status: "pending",
          run_at: bumpRunAtFromNow(),
          attempts: (job.attempts ?? 0) + 1,
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      results.push({ id: job.id, action: "skipped", error: `retry scheduled: ${errMsg}` });
      continue;
    }

    if (!conn?.x_access_token) {
      const errMsg = "X is not connected for this user (missing x_access_token in x_connections).";

      await supabase
        .from("scheduled_posts")
        .update({
          status: "needs_user_action",
          attempts: (job.attempts ?? 0) + 1,
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      needsUserAction++;
      results.push({ id: job.id, action: "needs_user_action", error: errMsg });
      continue;
    }

    // ③ 投稿（期限切れなら先にrefresh、401ならrefresh→再試行1回）
    let r: { ok: boolean; status: number; json: any };

    try {
      // まず期限切れチェック → refresh（できる場合）
      if (needsRefreshSoon(conn.x_expires_at) && conn.x_refresh_token) {
        const rr = await refreshXTokenForUser(conn);

        if (!rr.ok && isRetryableHttpStatus(rr.status)) {
          const errMsg = clampError(`X refresh retryable (${rr.status}): ${JSON.stringify(rr.json)}`);

          await supabase
            .from("scheduled_posts")
            .update({
              status: "pending",
              run_at: bumpRunAtFromNow(),
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.push({ id: job.id, action: "skipped", error: `retry scheduled: ${errMsg}` });
          continue;
        }

        if (!rr.ok) {
          const errMsg = clampError(`X refresh failed (${rr.status}): ${JSON.stringify(rr.json)}`);

          await supabase
            .from("scheduled_posts")
            .update({
              status: "needs_user_action",
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          needsUserAction++;
          results.push({ id: job.id, action: "needs_user_action", error: errMsg });
          continue;
        }

        const newAccess = rr.json?.access_token as string | undefined;
        const newRefresh = (rr.json?.refresh_token as string | undefined) ?? conn.x_refresh_token;
        const expiresIn = rr.json?.expires_in as number | undefined;

        if (!newAccess) {
          const errMsg = clampError(`X refresh ok but access_token missing: ${JSON.stringify(rr.json)}`);

          await supabase
            .from("scheduled_posts")
            .update({
              status: "needs_user_action",
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          needsUserAction++;
          results.push({ id: job.id, action: "needs_user_action", error: errMsg });
          continue;
        }

        const expiresAt =
          typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

        await supabase
          .from("x_connections")
          .update({
            x_access_token: newAccess,
            x_refresh_token: newRefresh,
            ...(expiresAt ? { x_expires_at: expiresAt } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", job.user_id);

        conn = { ...conn, x_access_token: newAccess, x_refresh_token: newRefresh, x_expires_at: expiresAt };
      }

      // 投稿
const accessToken = conn.x_access_token;

if (!accessToken) {
  const errMsg = "X is not connected for this user (missing x_access_token).";
  await supabase
    .from("scheduled_posts")
    .update({
      status: "needs_user_action",
      attempts: (job.attempts ?? 0) + 1,
      last_error: errMsg,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  needsUserAction++;
  results.push({ id: job.id, action: "needs_user_action", error: errMsg });
  continue;
}

r = await postToX(accessToken, job.text);

      // 401ならrefresh→再投稿（1回だけ）
      if (!r.ok && r.status === 401) {
        if (!conn.x_refresh_token) {
          const errMsg = "X post failed (401): refresh_token missing (need re-auth)";

          await supabase
            .from("scheduled_posts")
            .update({
              status: "needs_user_action",
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          needsUserAction++;
          results.push({ id: job.id, action: "needs_user_action", error: errMsg });
          continue;
        }

        const rr = await refreshXTokenForUser(conn);

        if (!rr.ok && isRetryableHttpStatus(rr.status)) {
          const errMsg = clampError(`X refresh retryable (${rr.status}): ${JSON.stringify(rr.json)}`);

          await supabase
            .from("scheduled_posts")
            .update({
              status: "pending",
              run_at: bumpRunAtFromNow(),
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.push({ id: job.id, action: "skipped", error: `retry scheduled: ${errMsg}` });
          continue;
        }

        if (!rr.ok) {
          const errMsg = clampError(`X refresh failed (${rr.status}): ${JSON.stringify(rr.json)}`);

          await supabase
            .from("scheduled_posts")
            .update({
              status: "needs_user_action",
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          needsUserAction++;
          results.push({ id: job.id, action: "needs_user_action", error: errMsg });
          continue;
        }

        const newAccess = rr.json?.access_token as string | undefined;
        const newRefresh = (rr.json?.refresh_token as string | undefined) ?? conn.x_refresh_token;
        const expiresIn = rr.json?.expires_in as number | undefined;

        if (!newAccess) {
          const errMsg = clampError(`X refresh ok but access_token missing: ${JSON.stringify(rr.json)}`);

          await supabase
            .from("scheduled_posts")
            .update({
              status: "needs_user_action",
              attempts: (job.attempts ?? 0) + 1,
              last_error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          needsUserAction++;
          results.push({ id: job.id, action: "needs_user_action", error: errMsg });
          continue;
        }

        const expiresAt =
          typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

        await supabase
          .from("x_connections")
          .update({
            x_access_token: newAccess,
            x_refresh_token: newRefresh,
            ...(expiresAt ? { x_expires_at: expiresAt } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", job.user_id);

        // 再投稿（1回だけ）
const accessToken = conn.x_access_token;

if (!accessToken) {
  const errMsg = "X is not connected for this user (missing x_access_token).";
  await supabase
    .from("scheduled_posts")
    .update({
      status: "needs_user_action",
      attempts: (job.attempts ?? 0) + 1,
      last_error: errMsg,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  needsUserAction++;
  results.push({ id: job.id, action: "needs_user_action", error: errMsg });
  continue;
}

r = await postToX(accessToken, job.text);
      }
    } catch (e: any) {
      // ✅ ネットワーク例外などは延期（failed固定にしない）
      const errMsg = clampError(`Exception: ${String(e?.message ?? e)}`);

      await supabase
        .from("scheduled_posts")
        .update({
          status: "pending",
          run_at: bumpRunAtFromNow(),
          attempts: (job.attempts ?? 0) + 1,
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      results.push({ id: job.id, action: "skipped", error: `retry scheduled: ${errMsg}` });
      continue;
    }

    // ここから先は「最終結果」で判定
    if (!r.ok) {
      const errMsg = clampError(`X post failed (${r.status}): ${JSON.stringify(r.json)}`);

      // ✅ 401/403 は再連携が必要扱い
      if (r.status === 401 || r.status === 403) {
        await supabase
          .from("scheduled_posts")
          .update({
            status: "needs_user_action",
            attempts: (job.attempts ?? 0) + 1,
            last_error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        needsUserAction++;
        results.push({ id: job.id, action: "needs_user_action", error: errMsg });
        continue;
      }

      // ✅ 429/5xx/timeout系は延期（pendingに戻してrun_atを未来へ）
      if (isRetryableHttpStatus(r.status)) {
        await supabase
          .from("scheduled_posts")
          .update({
            status: "pending",
            run_at: bumpRunAtFromNow(),
            attempts: (job.attempts ?? 0) + 1,
            last_error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        results.push({ id: job.id, action: "skipped", error: `retry scheduled: ${errMsg}` });
        continue;
      }

      // ✅ それ以外は恒久失敗として failed
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
        last_error: "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    sent++;
    results.push({ id: job.id, action: "sent", tweetId });
  }

  return NextResponse.json({ ok: true, processed, sent, failed, needs_user_action: needsUserAction, results });
}
