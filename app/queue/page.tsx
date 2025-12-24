"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  provider: string;
  text: string;
  run_at: string;
  status: string;
  attempts: number | null;
  last_error: string | null;
  tweet_id: string | null;
  updated_at: string | null;
};

function fmt(dtIso: string) {
  const d = new Date(dtIso);
  if (Number.isNaN(d.getTime())) return dtIso;
  return d.toLocaleString();
}

function badgeClass(status: string) {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "running":
      return "bg-blue-100 text-blue-800";
    case "sent":
      return "bg-emerald-100 text-emerald-800";
    case "failed":
      return "bg-rose-100 text-rose-800";
    case "cancelled":
      return "bg-neutral-200 text-neutral-800";
    default:
      return "bg-neutral-100 text-neutral-700";
  }
}

export default function QueuePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/schedule/list", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(String(data?.error ?? "Failed to load"));
        return;
      }
      setItems((data?.items ?? []) as Item[]);
    } catch {
      setErr("通信エラー");
    } finally {
      setLoading(false);
    }
  }

  async function cancel(id: string) {
    if (!confirm("この予約をキャンセルしますか？")) return;
    try {
      const res = await fetch("/api/schedule/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(String(data?.error ?? "Failed to cancel"));
        return;
      }
      await load();
    } catch {
      alert("通信エラー");
    }
  }

  useEffect(() => {
    load();
    // 10秒おきに自動更新（MVP）
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((x) => x.status === filter);
  }, [items, filter]);

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">予約一覧（Queue）</div>
          <button
            className="rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            onClick={load}
            disabled={loading}
          >
            {loading ? "更新中…" : "更新"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {["all", "pending", "running", "sent", "failed", "cancelled"].map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filter === k ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        {err && <div className="mt-3 text-sm text-rose-700">⚠️ {err}</div>}

        <div className="mt-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-sm text-neutral-600">まだ予約がありません。</div>
          ) : (
            filtered.map((it) => {
              const tweetUrl = it.tweet_id ? `https://x.com/i/web/status/${it.tweet_id}` : null;
              const canCancel = it.status === "pending" || it.status === "running";
              return (
                <div key={it.id} className="rounded-2xl border bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(it.status)}`}>
                          {it.status}
                        </span>
                        <span className="text-xs text-neutral-500">実行: {fmt(it.run_at)}</span>
                        {it.provider && <span className="text-xs text-neutral-500">provider: {it.provider}</span>}
                      </div>

                      <div className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-900">{it.text}</div>

                      {it.last_error && (
                        <div className="mt-2 rounded-xl bg-rose-50 p-2 text-xs text-rose-700">
                          error: {it.last_error}
                        </div>
                      )}

                      <div className="mt-2 text-xs text-neutral-500">
                        attempts: {it.attempts ?? 0} / updated: {it.updated_at ? fmt(it.updated_at) : "-"}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-2">
                      {tweetUrl && (
                        <a
                          href={tweetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white text-center"
                        >
                          投稿を開く
                        </a>
                      )}
                      {canCancel && (
                        <button
                          onClick={() => cancel(it.id)}
                          className="rounded-xl bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-800"
                        >
                          キャンセル
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
