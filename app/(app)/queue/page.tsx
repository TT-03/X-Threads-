"use client";

import { useEffect, useState } from "react";

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

export default function QueuePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/queue", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }

        if (alive) setItems(json.items ?? []);
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

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Queue</h1>
      <p style={{ opacity: 0.7 }}>予約の状態（pending/running/sent/failed/auth_required）を確認できます。</p>

      {loading ? <div style={{ marginTop: 16, opacity: 0.7 }}>Loading…</div> : null}

      {error ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #f99", borderRadius: 12 }}>
          <div style={{ fontWeight: 700 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          <div style={{ marginTop: 8, opacity: 0.7 }}>
            ※ 未連携（x_user_id cookie無し / x_tokens無し）の場合は 401 になります
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {items.map((it) => {
          const isAuthRequired = it.status === "auth_required";

          // ✅ AUTH REQUIRED は「投稿を開く」を絶対に出さない
          // （tweet_id が残っていてもリンク表示しない）
          const tweetUrl =
            !isAuthRequired && it.tweet_id ? `https://x.com/i/web/status/${it.tweet_id}` : null;

          // ✅ auth_required のときだけ last_error を短く（80）
          const errText =
            it.status === "failed"
              ? short(it.last_error, 140)
              : it.status === "auth_required"
              ? short(it.last_error, 80)
              : "";

          return (
            <div key={it.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{it.status.toUpperCase()}</div>
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

                {/* ✅ AUTH REQUIRED の時だけ「再連携」導線を出す */}
                {isAuthRequired ? (
                  <a href="/accounts">Xを再連携する</a>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && !error && items.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: 12 }}>まだ予約がありません。</div>
        ) : null}
      </div>
    </main>
  );
}
