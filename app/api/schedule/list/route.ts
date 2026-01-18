import { NextResponse } from "next/server";
import { getCookie } from "../../_lib/cookies";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export const runtime = "nodejs";

type Row = {
  id: string;
  provider: string;
  text: string;
  run_at: string;
  status: string;
  attempts: number | null;
  last_error: string | null;
  tweet_id: string | null;
  updated_at: string;
  group_id?: string | null;
  draft_id?: string | null;
};

function normalizeProvider(p: any) {
  return String(p ?? "").toLowerCase();
}

export async function GET() {
  try {
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json(
        { error: "Not connected. Missing x_user_id cookie." },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // group_id, draft_id も返す（DBで追加済みの前提）
    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .select(
        "id, provider, text, run_at, status, attempts, last_error, tweet_id, updated_at, group_id, draft_id"
      )
      .eq("user_id", userId)
      .order("run_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json(
        { error: "Failed to select scheduled_posts", details: error },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as Row[];

    // group_id が無い古いデータも混ざるので、無い場合は id を groupKey にする
    const groupsMap = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.group_id ? String(r.group_id) : `single:${r.id}`;
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key)!.push(r);
    }

    // group単位に整形
    const groups = Array.from(groupsMap.entries()).map(([groupKey, items]) => {
      // run_at は基本同じはずだが、念のため最小（早い）を採用
      const runAt = items
        .map((x) => new Date(x.run_at).getTime())
        .filter((t) => !Number.isNaN(t))
        .sort((a, b) => a - b)[0];

      const run_at = runAt ? new Date(runAt).toISOString() : items[0]?.run_at ?? null;

      const xItem = items.find((x) => normalizeProvider(x.provider) === "x") ?? null;
      const thItem = items.find((x) => normalizeProvider(x.provider) === "threads") ?? null;

      const destinations = items.map((x) => normalizeProvider(x.provider));

      // 「要対応」判定（Threadsが needs_user_action なら true）
      const needs_user_action = Boolean(thItem && thItem.status === "needs_user_action");

      // 代表テキスト（表示用）：XがあればX、無ければ先頭
      const display_text = (xItem?.text ?? items[0]?.text ?? "").toString();

      // グループ全体の状態（雑にまとめる）
      // 優先順位: needs_user_action > failed > auth_required > running > pending > sent
      const statuses = new Set(items.map((x) => x.status));
      let group_status = "sent";
      if (statuses.has("needs_user_action")) group_status = "needs_user_action";
      else if (statuses.has("failed")) group_status = "failed";
      else if (statuses.has("auth_required")) group_status = "auth_required";
      else if (statuses.has("running")) group_status = "running";
      else if (statuses.has("pending")) group_status = "pending";

      return {
        group_id: items[0]?.group_id ?? null,
        group_key: groupKey, // group_idが無い古いデータ用
        run_at,
        group_status,
        needs_user_action,
        destinations,
        display_text,

        // provider別の詳細（UIで必要なら使える）
        x: xItem,
        threads: thItem,

        items, // 生行も残す（デバッグ用）
      };
    });

    // run_at desc で並び替え（新しい予約が上）
    groups.sort((a, b) => {
      const ta = a.run_at ? new Date(a.run_at).getTime() : 0;
      const tb = b.run_at ? new Date(b.run_at).getTime() : 0;
      return tb - ta;
    });

    return NextResponse.json(
      { ok: true, groups, rawItems: rows },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
