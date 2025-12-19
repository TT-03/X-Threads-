"use client";

import { useEffect, useState } from "react";

export default function AccountsClient() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/x/status", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setConnected(Boolean(data?.connected));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/x/disconnect", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-700">
      <div className="font-semibold">現在の状態</div>

      <div className="mt-2">
        {connected === null ? (
          <span className="text-neutral-500">確認中...</span>
        ) : connected ? (
          <span className="text-green-700">✅ X：連携中</span>
        ) : (
          <span className="text-red-700">⚠️ X：未連携</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          className={`block w-full rounded-2xl px-4 py-3 text-center text-sm font-semibold ${
            connected ? "bg-neutral-200 text-neutral-600" : "bg-neutral-900 text-white"
          }`}
          href="/api/auth/x/start"
          aria-disabled={connected ? true : undefined}
          onClick={(e) => {
            if (connected) e.preventDefault();
          }}
          title={connected ? "すでに連携済みです" : "Xと連携します"}
        >
          Xと連携する（OAuth）
        </a>

        <button
          className="block w-full rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-neutral-900 disabled:opacity-40"
          disabled={!connected || busy}
          onClick={disconnect}
          title={!connected ? "未連携のため解除できません" : "連携を解除します"}
        >
          解除（未連携にする）
        </button>
      </div>

      <div className="mt-2 text-xs text-neutral-500">
        解除すると、このアプリからXへ投稿できなくなります（再連携で復帰します）。
      </div>
    </div>
  );
}
