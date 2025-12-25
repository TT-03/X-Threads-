export const dynamic = "force-dynamic";

type Item = {
  id: string;
  provider: string;
  text: string;
  run_at: string;
  status: "pending" | "running" | "sent" | "failed";
  attempts: number | null;
  last_error: string | null;
  tweet_id: string | null;
  updated_at: string | null;
};

function short(s?: string | null, n = 140) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default async function QueuePage() {
  // 相対fetchでOK（NEXT_PUBLIC_BASE_URL不要）
  const res = await fetch("/api/queue", { cache: "no-store" });
  const json = await res.json();
  const items: Item[] = json.items ?? [];

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Queue</h1>
      <p style={{ opacity: 0.7 }}>
        予約の状態（pending/running/sent/failed）を確認できます。
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {items.map((it) => {
          const tweetUrl = it.tweet_id ? `https://x.com/i/web/status/${it.tweet_id}` : null;

          return (
            <div
              key={it.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>{it.status.toUpperCase()}</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  {new Date(it.run_at).toLocaleString()}
                </div>
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
                {it.status === "failed" && it.last_error ? (
                  <span>error: {short(it.last_error)}</span>
                ) : null}
                {tweetUrl ? (
                  <a href={tweetUrl} target="_blank" rel="noreferrer">
                    投稿を開く
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}

        {items.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: 12 }}>まだ予約がありません。</div>
        ) : null}
      </div>
    </main>
  );
}
