"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  provider: string;
  text: string;
  run_at: string;
  status: "pending" | "running" | "sent" | "failed" | "auth_required";
  attempts: number | null;
  last_error: string | null;
  tweet_id: string | null;
  updated_at: string | null;
};

function short(s?: string | null, n = 140) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function isNotConnectedMessage(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("not connected to x") ||
    m.includes("missing x_tokens") ||
    m.includes("missing x_user_id") ||
    m.includes("http 401")
  );
}

type Filter = "all" | "pending" | "failed" | "auth_required";

export default function QueuePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ フィルタ
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setItems([]); // 前回表示を残さない

        const res = await fetch("/api/queue", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (alive) setItems([]);
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }

        if (alive) setItems((json.items ?? []) as Item[]);
      } catch (e: any) {
        if (alive) setError(String(e?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const notConnected = !!(error && isNotConnectedMessage(error));

  const counts = useMemo(() => {
    const c = { all: items.length, pending: 0, failed: 0, auth_required: 0 } as const;
    let pending = 0;
    let failed = 0;
    let auth_required = 0;

    for (const it of items) {
      if (it.status === "pending") pending++;
      if (it.status === "failed") failed++;
      if (it.status === "auth_required") auth_required++;
    }

    return { all: items.length, pending, failed, auth_required };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((it) => it.status === filter);
  }, [items, filter]);

  const filterButtonStyle = (active: boolean) =>
    ({
      padding: "6px 10px",
      border: "1px solid #ddd",
      borderRadius: 10,
      background: active ? "#f3f3f3" : "white",
      cursor: "pointer",
      fontWeight: active ? 700 : 400,
    } as const);

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      {/* ヘッダー（タイトル・フィルタ・更新） */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Queue</h1>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* ✅ フィルタ */}
          <button onClick={() => setFilter("all")} style={filterButtonStyle(filter === "all")}>
            All ({counts.all})
          </button>
          <button onClick={() => setFilter("pending")} style={filterButtonStyle(filter === "pending")}>
            Pending ({counts.pending})
          </button>
          <button onClick={() => setFilter("failed")} style={filterButtonStyle(filter === "failed")}>
            Failed ({counts.failed})
          </button>
          <button
            onClick={() => setFilter("auth_required")}
            style={filterButtonStyle(filter === "auth_required")}
          >
            Auth ({counts.auth_required})
          </button>

          {/* ✅ 更新 */}
          <button
            onClick={() => location.reload()}
            style={{
              padding: "6px 10px",
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              cursor: "pointer",
            }}
          >
            更新
          </button>
        </div>
      </div>

      <p style={{ opacity: 0.7 }}>
        予約の状態（pending/running/sent/failed）を確認できます。
      </p>

      {loading ? <div style={{ marginTop: 16, opacity: 0.7 }}>Loading…</div> : null}

      {error ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #f99", borderRadius: 12 }}>
          <div style={{ fontWeight: 700 }}>{notConnected ? "未連携" : "Error"}</div>

          {notConnected ? (
            <>
              <div style={{ marginTop: 6 }}>X連携が必要です。</div>
              <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a href="/api/auth/x/start" style={{ fontWeight: 700 }}>
                  Xを連携する
                </a>
                <a href="/api/x/disconnect" style={{ opacity: 0.7 }}>
                  （念のため）連携情報をリセット
                </a>
              </div>
              <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                ※ cookie は残っていても、x_tokens が無い場合は未連携扱いになります
              </div>
            </>
          ) : (
            <>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{error}</div>
              <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                ※ 一時的な不具合の可能性があります。時間をおいて再読み込みしてください。
              </div>
            </>
          )}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {filteredItems.map((it) => {
          const isAuthRequired = it.status === "auth_required";

          // AUTH REQUIRED のときは「投稿を開く」を出さない（tweet_idがあっても念のため）
          const tweetUrl =
            !isAuthRequired && it.tweet_id ? `https://x.com/i/web/status/${it.tweet_id}` : null;

          // auth_required のときだけ last_error を短くする
          const errShort = it.last_error ? short(it.last_error, isAuthRequired ? 80 : 140) : null;

          return (
            <div key={it.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>
                  {isAuthRequired ? "AUTH REQUIRED" : it.status.toUpperCase()}
                </div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>{new Date(it.run_at).toLocaleString()}</div>
              </div>

              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{it.text}</div>

              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  fontSize: 12,
                  opacity: 0.85,
                  alignItems: "center",
                }}
              >
                <span>attempts: {it.attempts ?? 0}</span>

                {errShort ? <span>error: {errShort}</span> : null}

                {tweetUrl ? (
                  <a href={tweetUrl} target="_blank" rel="noreferrer">
                    投稿を開く
                  </a>
                ) : null}

                {isAuthRequired ? (
                  <a href="/api/auth/x/start" style={{ fontWeight: 700 }}>
                    Xを再連携する
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && !error && filteredItems.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: 12 }}>
            {filter === "all" ? "まだ予約がありません。" : "このステータスの予約はありません。"}
          </div>
        ) : null}
      </div>
    </main>
  );
}
