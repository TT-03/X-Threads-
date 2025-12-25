"use client";

import { useEffect, useMemo, useState } from "react";

type Status = "pending" | "running" | "sent" | "failed" | "auth_required";

type Item = {
  id: string;
  provider: string;
  text: string;
  run_at: string;
  status: Status;
  attempts: number | null;
  last_error: string | null;
  tweet_id: string | null;
  updated_at: string | null;
};

function short(s?: string | null, n = 140) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function statusLabel(s: Status) {
  switch (s) {
    case "pending":
      return "PENDING";
    case "running":
      return "RUNNING";
    case "sent":
      return "SENT";
    case "failed":
      return "FAILED";
    case "auth_required":
      return "AUTH REQUIRED";
    default:
      return String(s).toUpperCase();
  }
}

function badgeStyle(s: Status): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #ddd",
    background: "#f7f7f7",
    color: "#111",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  if (s === "sent") return { ...base, background: "#eefbf0", borderColor: "#bfe8c7", color: "#126b2e" };
  if (s === "pending") return { ...base, background: "#fff7e6", borderColor: "#ffd59a", color: "#7a4b00" };
  if (s === "running") return { ...base, background: "#eef5ff", borderColor: "#c8dcff", color: "#1f4b99" };
  if (s === "failed") return { ...base, background: "#fff0f0", borderColor: "#ffb8b8", color: "#9b1c1c" };
  if (s === "auth_required") return { ...base, background: "#fff0f0", borderColor: "#ffb8b8", color: "#9b1c1c" };

  return base;
}

function cardStyle(s: Status): React.CSSProperties {
  const base: React.CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: 12,
    background: "#fff",
  };

  if (s === "failed" || s === "auth_required") return { ...base, borderColor: "#ffb8b8" };
  if (s === "pending") return { ...base, borderColor: "#ffd59a" };
  if (s === "running") return { ...base, borderColor: "#c8dcff" };
  if (s === "sent") return { ...base, borderColor: "#bfe8c7" };
  return base;
}

type FilterKey = "all" | "pending" | "failed" | "auth";

export default function QueuePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }

      const next = (json.items ?? []) as Item[];
      next.sort((a, b) => (a.run_at < b.run_at ? 1 : -1));
      setItems(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { all: items.length, pending: 0, failed: 0, auth: 0 };
    for (const it of items) {
      if (it.status === "pending") c.pending++;
      if (it.status === "failed") c.failed++;
      if (it.status === "auth_required") c.auth++;
    }
    return c;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "pending") return items.filter((x) => x.status === "pending");
    if (filter === "failed") return items.filter((x) => x.status === "failed");
    if (filter === "auth") return items.filter((x) => x.status === "auth_required");
    return items;
  }, [items, filter]);

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Queue</h1>
          <p style={{ opacity: 0.7 }}>予約の状態（pending/running/sent/failed/auth_required）を確認できます。</p>
        </div>

        {/* ✅ 更新ボタン（アイコン） */}
        <button
          onClick={load}
          disabled={loading}
          title={loading ? "更新中…" : "更新"}
          aria-label={loading ? "更新中" : "更新"}
          style={{
            border: "1px solid #ddd",
            background: "#fff",
            borderRadius: 999,
            padding: "8px 10px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ animation: loading ? "spin 1s linear infinite" : undefined }}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>

          <style jsx>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        </button>
      </div>

      {/* フィルタ */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")} label={`All (${counts.all})`} />
        <FilterButton active={filter === "pending"} onClick={() => setFilter("pending")} label={`Pending (${counts.pending})`} />
        <FilterButton active={filter === "failed"} onClick={() => setFilter("failed")} label={`Failed (${counts.failed})`} />
        <FilterButton active={filter === "auth"} onClick={() => setFilter("auth")} label={`Auth (${counts.auth})`} />
      </div>

      {loading ? <div style={{ marginTop: 16, opacity: 0.7 }}>Loading…</div> : null}

      {error ? (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid #ffb8b8",
            borderRadius: 12,
            background: "#fff0f0",
          }}
        >
          <div style={{ fontWeight: 700 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          <div style={{ marginTop: 8, opacity: 0.7 }}>
            ※ 未連携（x_user_id cookie無し / x_tokens無し）の場合は 401 になります
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {filteredItems.map((it) => {
          const isAuthRequired = it.status === "auth_required";

          const tweetUrl = !isAuthRequired && it.tweet_id ? `https://x.com/i/web/status/${it.tweet_id}` : null;

          const errText =
            it.status === "failed"
              ? short(it.last_error, 140)
              : it.status === "auth_required"
              ? short(it.last_error, 80)
              : "";

          return (
            <div key={it.id} style={cardStyle(it.status)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={badgeStyle(it.status)}>{statusLabel(it.status)}</span>
                </div>

                {/* ✅ 日時＋薄いID */}
                <div style={{ opacity: 0.7, fontSize: 12, textAlign: "right" }}>
                  <div>{new Date(it.run_at).toLocaleString()}</div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.5 }}>id: {it.id}</div>
                </div>
              </div>

              <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{it.text}</div>

              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  fontSize: 12,
                  opacity: 0.9,
                  alignItems: "center",
                }}
              >
                <span>attempts: {it.attempts ?? 0}</span>

                {(it.status === "failed" || it.status === "auth_required") && it.last_error ? (
                  <span>error: {errText}</span>
                ) : null}

                {tweetUrl ? (
                  <a href={tweetUrl} target="_blank" rel="noreferrer">
                    投稿を開く
                  </a>
                ) : null}

                {isAuthRequired ? <a href="/accounts">Xを再連携する</a> : null}
              </div>
            </div>
          );
        })}

        {!loading && !error && filteredItems.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: 12 }}>
            {filter === "all"
              ? "まだ予約がありません。"
              : filter === "pending"
              ? "Pending はありません。"
              : filter === "failed"
              ? "Failed はありません。"
              : "Auth Required はありません。"}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "1px solid #ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
        borderRadius: 999,
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
