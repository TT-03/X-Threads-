"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function countXChars(s: string) {
  // MVP: 単純な文字数。Xのカウントルール(URL等)は後で対応。
  return [...s].length;
}

type ToastKind = "success" | "error" | "info";
type ToastState = {
  kind: ToastKind;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// datetime-local 用（ローカル時刻の "YYYY-MM-DDTHH:mm" を作る）
function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

// datetime-local ("YYYY-MM-DDTHH:mm") をローカル時刻として Date にする
function parseDatetimeLocal(value: string): Date | null {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;

  const [y, m, d] = datePart.split("-").map((v) => Number(v));
  const [hh, mm] = timePart.split(":").map((v) => Number(v));
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

  return new Date(y, m - 1, d, hh, mm, 0);
}

export default function ComposePage() {
  const router = useRouter();
  const [text, setText] = useState("");

  // ✅ 投稿先チェックボックス（複数選択）
  const [destX, setDestX] = useState(true);
  const [destThreads, setDestThreads] = useState(false);

  // ✅ 追加：予約日時（datetime-local）
  // 初期値：今から3分後
  const [runAtLocal, setRunAtLocal] = useState<string>(() => {
    const d = new Date(Date.now() + 3 * 60 * 1000);
    return toDatetimeLocalValue(d);
  });

  const [toast, setToast] = useState<ToastState | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);

  // ✅ 追加：レート制限（429）カウントダウン
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(0);

  const trimmed = useMemo(() => text.trim(), [text]);
  const xCount = useMemo(() => countXChars(trimmed), [trimmed]);

  // トーストは数秒で自動で消す
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const isRateLimited = rateLimitUntil != null && Date.now() < rateLimitUntil;

  // ✅ 429のカウントダウン更新
  useEffect(() => {
    if (!rateLimitUntil) return;

    const tick = () => {
      const remain = Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000));
      setRateLimitRemaining(remain);
      if (remain <= 0) setRateLimitUntil(null);
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [rateLimitUntil]);

  function showToast(next: ToastState) {
    setToast(next);
  }

  const destinations = useMemo(() => {
    const d: ("x" | "threads")[] = [];
    if (destX) d.push("x");
    if (destThreads) d.push("threads");
    return d;
  }, [destX, destThreads]);

  const canPostNowX = destX && !!trimmed && !isPosting && !isRateLimited;

  async function postNowX() {
    if (isPosting) return;

    if (!destX) {
      showToast({ kind: "info", title: "Xが未選択です", detail: "今すぐ投稿はXのみ対応です。" });
      return;
    }

    if (isRateLimited) {
      showToast({
        kind: "error",
        title: "制限中です",
        detail: `あと${rateLimitRemaining}秒ほど待ってから再度お試しください。`,
      });
      return;
    }

    if (!trimmed) return;

    if (countXChars(trimmed) > 280) {
      showToast({ kind: "error", title: "文字数オーバーです", detail: "Xは280文字以内にしてください。" });
      return;
    }

    setIsPosting(true);

    try {
      const res = await fetch("/api/x/tweet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const connectUrl = typeof data?.connectUrl === "string" ? data.connectUrl : undefined;

        // ✅ 429
        const is429 = res.status === 429 || data?.error === "RATE_LIMITED";
        if (is429) {
          const retryAfter =
            typeof data?.retryAfter === "number" && Number.isFinite(data.retryAfter) ? data.retryAfter : 60;

          setRateLimitUntil(Date.now() + retryAfter * 1000);

          showToast({
            kind: "error",
            title: "投稿が多すぎます（制限中）",
            detail: `あと${retryAfter}秒ほど待ってから再度お試しください。`,
          });
          return;
        }

        const msg =
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.details?.detail === "string" && data.details.detail) ||
          (typeof data?.detail === "string" && data.detail) ||
          "投稿に失敗しました。";

        const isDuplicate = res.status === 409 || data?.error === "DUPLICATE_TWEET";

        showToast({
          kind: "error",
          title: isDuplicate ? "同じ内容の投稿はできません" : "投稿に失敗しました",
          detail: String(msg),
          actionLabel: connectUrl ? "連携する" : undefined,
          onAction: connectUrl ? () => router.push(connectUrl) : undefined,
        });
        return;
      }

      const tweetId = data?.data?.id as string | undefined;
      const href = tweetId ? `https://x.com/i/web/status/${tweetId}` : undefined;

      showToast({
        kind: "success",
        title: "投稿しました（X）",
        detail: tweetId ? `Tweet ID: ${tweetId}` : undefined,
        actionLabel: href ? "投稿を開く" : undefined,
        onAction: href ? () => window.open(href, "_blank", "noreferrer") : undefined,
      });

      setText("");
    } catch {
      showToast({
        kind: "error",
        title: "通信エラー",
        detail: "ネットワーク状況を確認して、もう一度お試しください。",
      });
    } finally {
      setIsPosting(false);
    }
  }

  async function schedule() {
    if (isScheduling || isPosting) return;
    if (!trimmed) return;

    if (destinations.length === 0) {
      showToast({ kind: "error", title: "投稿先が未選択です", detail: "XまたはThreadsを選んでください。" });
      return;
    }

    // Xが選ばれている時だけ280チェック
    if (destX && countXChars(trimmed) > 280) {
      showToast({ kind: "error", title: "文字数オーバーです", detail: "Xは280文字以内にしてください。" });
      return;
    }

    // ✅ 予約日時チェック（最低：今から30秒以上先）
    const d = parseDatetimeLocal(runAtLocal);
    if (!d) {
      showToast({ kind: "error", title: "予約日時が不正です", detail: "日時を選び直してください。" });
      return;
    }
    if (d.getTime() < Date.now() + 30_000) {
      showToast({ kind: "error", title: "予約が早すぎます", detail: "今から30秒以上先の日時にしてください。" });
      return;
    }

    setIsScheduling(true);

    try {
      const runAt = d.toISOString(); // APIへはISOで送る

      // ✅ 新仕様：items + destinations で送る
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              text: trimmed,
              runAt,
              run_at: runAt, // 互換のため両方
              destinations, // ["x","threads"] 等
            },
          ],
        }),
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const msg =
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.message === "string" && data.message) ||
          "予約に失敗しました。";
        showToast({ kind: "error", title: "予約に失敗しました", detail: String(msg) });
        return;
      }

      showToast({
        kind: "success",
        title: "予約しました",
        detail: `実行: ${new Date(runAt).toLocaleString()}`,
        actionLabel: "予約一覧を見る",
        onAction: () => router.push("/queue"),
      });

      setText("");
    } catch {
      showToast({ kind: "error", title: "通信エラー", detail: "ネットワーク状況を確認して、もう一度お試しください。" });
    } finally {
      setIsScheduling(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">投稿を作成</div>
          <div className="text-xs text-neutral-500">
            {destX ? `X: ${xCount}/280` : "X: 未選択"} / {destThreads ? "Threads: 選択中" : "Threads: 未選択"}
          </div>
        </div>

        {/* ✅ 投稿先チェックボックス */}
        <div className="mt-3 rounded-2xl border bg-white p-3">
          <div className="text-xs font-semibold text-neutral-700">投稿先（複数選択可）</div>
          <div className="mt-2 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={destX} onChange={(e) => setDestX(e.target.checked)} />
              <span>X</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={destThreads} onChange={(e) => setDestThreads(e.target.checked)} />
              <span>Threads（通知投稿）</span>
            </label>
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            ※ ThreadsはMVPでは「要対応（通知）」になります（Queueでコピー→完了）。
          </div>
        </div>

        {/* ✅ 追加：予約日時 */}
        <div className="mt-3 rounded-2xl border bg-white p-3">
          <div className="text-xs font-semibold text-neutral-700">予約日時</div>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="datetime-local"
              className="rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              value={runAtLocal}
              onChange={(e) => setRunAtLocal(e.target.value)}
              step={60}
            />
            <button
              type="button"
              className="rounded-xl bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-800 active:bg-neutral-200"
              onClick={() => setRunAtLocal(toDatetimeLocalValue(new Date(Date.now() + 3 * 60 * 1000)))}
            >
              今+3分に戻す
            </button>
          </div>
          <div className="mt-2 text-xs text-neutral-500">※ 30秒以上先の日時にしてください</div>
        </div>

        <textarea
          className="mt-3 h-40 w-full resize-none rounded-2xl border bg-white p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-neutral-200"
          placeholder="ここに文章を貼る / 書く（MVP）"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {/* ✅ 任意：制限中の表示 */}
        {isRateLimited && (
          <div className="mt-2 text-xs text-amber-700">制限中：あと {rateLimitRemaining} 秒で再投稿できます</div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            className="rounded-2xl bg-neutral-900 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40"
            onClick={postNowX}
            disabled={!canPostNowX || !destX}
          >
            {isPosting ? "投稿中…" : isRateLimited ? `制限中（${rateLimitRemaining}s）` : "今すぐ投稿（X）"}
          </button>

          <button
            className="rounded-2xl bg-neutral-100 px-3 py-3 text-sm font-semibold text-neutral-800 active:bg-neutral-200 disabled:opacity-40"
            onClick={schedule}
            disabled={isPosting || isScheduling || !trimmed || destinations.length === 0}
          >
            {isScheduling ? "予約中…" : "予約に入れる"}
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3">
          <div className="text-xs font-semibold text-neutral-700">Pro機能（予定）</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
            <li>長文 → 要約 → 複数投稿化（2〜3クレジット）</li>
            <li>自動ハッシュタグ提案 / リライト</li>
            <li>投稿前チェック（NGワード・リンク数・文字数など）</li>
          </ul>
        </div>
      </div>

      {/* トースト（画面下に固定表示） */}
      {toast && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <div className="mx-auto max-w-md rounded-2xl border bg-white p-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {toast.kind === "success" ? "✅ " : toast.kind === "error" ? "⚠️ " : "ℹ️ "}
                  {toast.title}
                </div>

                {toast.detail && <div className="mt-1 break-words text-xs text-neutral-600">{toast.detail}</div>}

                <div className="mt-3 flex flex-wrap gap-2">
                  {toast.onAction && toast.actionLabel && (
                    <button
                      onClick={() => {
                        toast.onAction?.();
                        setToast(null);
                      }}
                      className="inline-flex items-center justify-center rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white"
                    >
                      {toast.actionLabel}
                    </button>
                  )}

                  <button
                    onClick={() => setToast(null)}
                    className="rounded-xl bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-800"
                    aria-label="close"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
