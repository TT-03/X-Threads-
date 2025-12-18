"use client";

import { useMemo, useState } from "react";

function countXChars(s: string) {
  // MVP: 単純な文字数。Xのカウントルール(URL等)は後で対応。
  return [...s].length;
}

export default function ComposePage() {
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<"x" | "threads">("x");
  const xCount = useMemo(() => countXChars(text), [text]);

  async function postNow() {
    const res = await fetch("/api/x/tweet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error ?? "投稿に失敗しました（連携が必要かも）");
      return;
    }
    alert("投稿しました！（MVP）\n" + JSON.stringify(data, null, 2));
    setText("");
  }

  function schedule() {
    alert("予約機能はUIのみ同梱（DB/ジョブキューは次段階）");
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
            disabled={!text.trim() || platform !== "x"}
            title={platform !== "x" ? "Threadsは次段階で対応します" : ""}
          >
            今すぐ投稿（X）
          </button>
          <button
            className="rounded-2xl bg-neutral-100 px-3 py-3 text-sm font-semibold text-neutral-800 active:bg-neutral-200"
            onClick={schedule}
            disabled={!text.trim()}
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
    </section>
  );
}
