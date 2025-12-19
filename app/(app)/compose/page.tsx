"use client";

import { useEffect, useMemo, useState } from "react";

function countXChars(s: string) {
  // MVP: 単純な文字数。Xのカウントルール(URL等)は後で対応。
  return [...s].length;
}

type ToastKind = "success" | "error" | "info";
type ToastState = {
  kind: ToastKind;
  title: string;
  detail?: string;
  actionHref?: string;
  actionLabel?: string;
};

export default function ComposePage() {
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<"x" | "threads">("x");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const xCount = useMemo(() => countXChars(text), [text]);

  // トーストは数秒で自動で消す（邪魔になりすぎないように）
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(next: ToastState) {
    setToast(next);
  }

  async function postNow() {
    if (isPosting) return;
    setIsPosting(true);

    try {
      const res = await fetch("/api/x/tweet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
  const msg =
    data?.error ??
    data?.detail ??
    "投稿に失敗しました（X連携が必要、または権限が不足している可能性があります）";

  const connectUrl = data?.connectUrl as string | undefined;

  showToast({
    kind: "error",
    title: "投稿に失敗しました",
    detail: String(msg),
    actionHref: connectUrl,                 // ★ここが追加
    actionLabel: connectUrl ? "連携する" : undefined, // ★ここが追加
  });
  return;
}


      // 成功時：Tweet ID から投稿URLを作って「投稿を開く」ボタンを出す
      const tweetId = data?.data?.id as string | undefined;
      const href = tweetId ? `https://x.com/i/web/status/${tweetId}` : undefined;

      showToast({
        kind: "success",
        title: "投稿しました",
        detail: tweetId ? `Tweet ID: ${tweetId}` : undefined,
        actionHref: href,
        actionLabel: href ? "投稿を開く" : undefined,
      });

      setText("");
    } catch (e) {
      showToast({
        kind: "error",
        title: "通信エラー",
        detail: "ネットワーク状況を確認して、もう一度お試しください。",
      });
    } finally {
        setIsPosting(false);
    }
  }
  function schedule() {
    showToast({
      kind: "info",
      title: "予約機能は準備中です",
      detail: "現状はUIのみ（DB/ジョブキューは次段階で対応）",
    });
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">投稿を作成</div>
          <div className="text-xs text-neutral-500">
            {platform === "x" ? `X: ${xCount}/280` : "Threads: (後で制限対応)"}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            className={`flex-1 rounded-2xl px-3 py-2 text-sm font-semibold ${
              platform === "x" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"
            }`}
            onClick={() => setPlatform("x")}
          >
            X
          </button>
          <button
            className={`flex-1 rounded-2xl px-3 py-2 text-sm font-semibold ${
              platform === "threads" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"
            }`}
            onClick={() => setPlatform("threads")}
          >
            Threads（準備中）
          </button>
        </div>

        <textarea
          className="mt-3 h-40 w-full resize-none rounded-2xl border bg-white p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-neutral-200"
          placeholder="ここに文章を貼る / 書く（MVP）"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            className="rounded-2xl bg-neutral-900 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40"
            onClick={postNow}
            disabled={!text.trim() || platform !== "x" || isPosting}
          >
            {isPosting ? "投稿中…" : "今すぐ投稿（X）"}
          </button>
          <button
            className="rounded-2xl bg-neutral-100 px-3 py-3 text-sm font-semibold text-neutral-800 active:bg-neutral-200 disabled:opacity-40"
            onClick={schedule}
            disabled={isPosting || !text.trim()}
          >
            予約に入れる
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
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {toast.kind === "success" ? "✅ " : toast.kind === "error" ? "⚠️ " : "ℹ️ "}
                  {toast.title}
                </div>
                {toast.detail && <div className="mt-1 break-words text-sm text-neutral-700">{toast.detail}</div>}
                {toast.actionHref && toast.actionLabel && (
                  <div className="mt-3">
                    <a
                      href={toast.actionHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white"
                    >
                      {toast.actionLabel}
                    </a>
                  </div>
                )}
              </div>

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
      )}
    </section>
  );
}
