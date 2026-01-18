import { NextResponse } from "next/server";
import { getCookie } from "../_lib/cookies";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

/**
 * 対応する入力（どっちでもOK）
 * ① 旧形式（今まで通り）
 *  { text, provider, runAt }
 *
 * ② 新形式（複数予約＆投稿先チェックボックス）
 *  {
 *    items: [
 *      { text, runAt, destinations: ["x","threads"], draft_id? }
 *    ]
 *  }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // cookie（callbackで入れたやつ）
    const userId = await getCookie("x_user_id");
    if (!userId) {
      return NextResponse.json(
        { error: "Not connected. Missing x_user_id cookie." },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // -------------------------
    // 1) 入力を「items配列」に統一
    // -------------------------
    const itemsRaw = Array.isArray(body?.items)
      ? body.items
      : [
          {
            text: (body?.text ?? "").toString(),
            // 旧形式は provider 1つだけ → destinations に変換
            destinations: [((body?.provider ?? "x").toString() || "x")],
            runAt: (body?.runAt ?? body?.run_at ?? "").toString(),
          },
        ];

    // -------------------------
    // 2) itemsを検証＆insert行を作る
    // -------------------------
    const insertRows: any[] = [];

    for (const it of itemsRaw) {
      const text = (it?.text ?? "").toString();
      const runAtRaw = it?.runAt ?? it?.run_at;
      const runAt = (runAtRaw ?? "").toString();

      // destinations: ["x","threads"] の想定（1つでもOK）
      const destinations = Array.isArray(it?.destinations)
        ? it.destinations.map((v: any) => String(v))
        : Array.isArray(it?.providers)
        ? it.providers.map((v: any) => String(v))
        : [String(it?.provider ?? "x")];

      const normDest = Array.from(new Set(destinations as string[]))
  .map((d: string) => d.toLowerCase())
  .filter((d: string) => d === "x" || d === "threads");


      if (normDest.length === 0) {
        return NextResponse.json(
          { error: "destinations is invalid. Use ['x'] or ['threads'] or both." },
          { status: 400 }
        );
      }

      if (!text || text.trim().length === 0) {
        return NextResponse.json({ error: "Text is required" }, { status: 400 });
      }

      // Xだけは280文字制限（ThreadsはMVPでは制限しない）
      if (normDest.includes("x") && text.length > 280) {
        return NextResponse.json(
          { error: "Text is too long for X (max 280)" },
          { status: 400 }
        );
      }

      const dt = new Date(runAt);
      if (!runAt || Number.isNaN(dt.getTime())) {
        return NextResponse.json(
          { error: "runAt is invalid (ISO string required)" },
          { status: 400 }
        );
      }
      if (dt.getTime() < Date.now() + 10_000) {
        return NextResponse.json(
          { error: "runAt must be in the future" },
          { status: 400 }
        );
      }

      // 両方投稿を束ねるID（x行とthreads行で共通にする）
      const groupId = randomUUID();
      const draftId = it?.draft_id ?? it?.draftId ?? null;

      for (const d of normDest) {
        insertRows.push({
          user_id: userId,
          provider: d, // "x" or "threads"
          text,
          run_at: dt.toISOString(),
          status: "pending",
          attempts: 0,
          last_error: null,

          // 既存互換（Xだけtweet_idが使われている前提）
          tweet_id: null,

          // 今回DBで追加した列（あれば入る）
          group_id: groupId,
          draft_id: draftId,
          provider_post_id: null,
          target_url: null,

          updated_at: new Date().toISOString(),
        });
      }
    }

    // -------------------------
    // 3) まとめてinsert（複数行）
    // -------------------------
    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .insert(insertRows)
      .select("id, user_id, provider, run_at, status, group_id, draft_id");

    if (error) {
      return NextResponse.json(
        { error: "Failed to insert scheduled_posts", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, scheduled: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
