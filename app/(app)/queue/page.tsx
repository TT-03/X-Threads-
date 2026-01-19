"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type GroupStatus =
  | "pending"
  | "running"
  | "sent"
  | "failed"
  | "auth_required"
  | "needs_user_action";

type Row = {
  id: string;
  provider: string; // "x" | "threads"
  text: string;
  run_at: string;
  status: string;
  attempts: number | null;
  last_error: string | null;
  tweet_id: string | null;
  updated_at: string | null;
  group_id?: string | null;
  draft_id?: string | null;
};

type Group = {
  group_id: string | null;
  group_key: string; // group_idが無い古いデータ用のキー
  run_at: string | null;
  group_status: GroupStatus;
  needs_user_action: boolean;
  destinations: string[]; // ["x","threads"]
  display_text: string;

  x: Row | null;
  threads: Row | null;
  items: Row[];
};

function short(s?: string | null, n = 140) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function shortId(id: string, head = 8, tail = 4) {
  if (!id) return "";
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function statusLabel(s: GroupStatus) {
  switch (s) {
    case "needs_user_action":
      return "NEEDS ACTION";
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

function badgeStyle(s: GroupStatus): CSSProperties {
  const base: CSSProperties = {
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
  if (s === "needs_user_action") return { ...base, background: "#eef5ff", borderColor: "#c8dcff", color: "#1f4b99" };
  if (s === "failed" || s === "auth_required")
    return { ...base, background: "#fff0f0", borderColor: "#ffb8b8", color: "#9b1c1c" };

  return base;
}

function cardStyle(s: GroupStatus): CSSProperties {
  const base: CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 12,
    padding: 12,
    background: "#fff",
  };

  if (s === "failed" || s === "auth_required") return { ...base, borderColor: "#ffb8b8" };
  if (s === "pending") return { ...base, borderColor: "#ffd59a" };
  if (s === "running") return { ...base, borderColor: "#c8dcff" };
  if (s === "needs_user_action") return { ...base, borderColor: "#c8dcff" };
  if (s === "sent") return { ...base, borderColor: "#bfe8c7" };
  return base;
}

type FilterKey = "all" | "pending" | "needs" | "failed" | "auth";

export default function QueuePage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  // コピー通知（右下トースト）
  const [copied, setCopied] = useState<string | null>(null);

  // 自動更新（一覧の更新）
  const [autoRefresh] = useState(true);

  // 管理者モード + secret
  const [adminMode, setAdminMode] = useState(false);
  const [cronSecretCached, setCronSecretCached] = useState<string | null>(null);

  // 自動実行（/api/schedule/run を1分ごとに叩く）
  const [autoRun, setAutoRun] = useState(true);
  const [isRunningNow, setIsRunningNow] = useState(false); // 二重実行防止

  // ---------- 共通：トースト表示 ----------
  function toast(msg: string) {
    setCopied(msg);
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setCopied(null), 3000);
  }

  // ---------- 管理者：secret 操作 ----------
  function saveSecret() {
    const input = window.prompt("CRON_SECRET を入力して保存します（タブを閉じるまで有効）");
    if (!input) return;
    sessionStorage.setItem("xthreads_cron_secret", input);
    setCronSecretCached(input);
    toast("CRON_SECRET を保存しました");
  }

  async function generateSecret() {
    // ブラウザで新しいsecretを作る（Vercel/Oracleの更新は手動が必要）
    const s =
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replaceAll("-", "")
        : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2));

    sessionStorage.setItem("xthreads_cron_secret", s);
    setCronSecretCached(s);

    // ついでにコピーできたらコピー
    try {
      await navigator.clipboard.writeText(s);
      toast("新secretを生成しました（コピー済み）※VercelとOracleも同じ値に更新してね");
    } catch {
      toast("新secretを生成しました ※VercelとOracleも同じ値に更新してね");
    }
  }

  function deleteSecret() {
    sessionStorage.removeItem("xthreads_cron_secret");
    setCronSecretCached(null);
    toast("secret を削除しました");
  }

  async function ensureSecret(): Promise<string | null> {
    if (cronSecretCached) return cronSecretCached;
    const input = window.prompt("CRON_SECRET を入力してください（管理者用）");
    if (!input) return null;
    sessionStorage.setItem("xthreads_cron_secret", input);
    setCronSecretCached(input);
    return input;
  }

  // ---------- API：一覧取得 ----------
  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/schedule/list", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setGroups((json.groups ?? []) as Group[]);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }

  // ---------- API：今すぐ実行 ----------
  async function runNow() {
    if (isRunningNow) return;
    setIsRunningNow(true);

    try {
      const secret = await ensureSecret();
      if (!secret) return;

      const res = await fetch("/api/schedule/run", {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      await load();
      toast(`実行しました：sent=${json?.sent ?? 0}, needs=${json?.needs_user_action ?? 0}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setIsRunningNow(false);
    }
  }

  // ---------- 便利：コピー ----------
  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("コピーしました");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast("コピーしました");
      } catch {
        toast("コピーに失敗しました（ブラウザ設定をご確認ください）");
      }
    }
  }

  function openThreads() {
    window.open("https://www.threads.net/", "_blank", "noreferrer");
  }

  async function cancelGroup(g: Group) {
    try {
      const payload = g.group_id ? { group_id: g.group_id } : { id: g.items?.[0]?.id };
      const res = await fetch("/api/schedule/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function completeThreads(g: Group) {
    try {
      const payload = g.group_id
        ? { group_id: g.group_id, provider: "threads" }
        : g.threads?.id
          ? { id: g.threads.id }
          : { id: g.items?.[0]?.id };

      const res = await fetch("/api/schedule/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  // 初回ロード + secret復元
  useEffect(() => {
    const saved = sessionStorage.getItem("xthreads_cron_secret");
    if (saved) setCronSecretCached(saved);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自動更新（1分ごとに一覧リロード）
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => load(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  // 自動実行（管理者モードON & secret保存済み & autoRun ON のときだけ）
  useEffect(() => {
    if (!adminMode) return;
    if (!autoRun) return;
    if (!cronSecretCached) return;

    const id = setInterval(() => {
      runNow();
    }, 60_000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMode, autoRun, cronSecretCached]);

  const counts = useMemo(() => {
    const c = { all: groups.length, pending: 0, needs: 0, failed: 0, auth: 0 };
    for (const g of groups) {
      if (g.group_status === "pending") c.pending++;
      if (g.group_status === "needs_user_action") c.needs++;
      if (g.group_status === "failed") c.failed++;
      if (g.group_status === "auth_required") c.auth++;
    }
    return c;
  }, [groups]);

  const filtered = useMemo(() => {
    if (filter === "all") return groups;
    if (filter === "pending") return groups.filter((g) => g.group_status === "pending");
    if (filter === "needs") return groups.filter((g) => g.group_status === "needs_user_action");
    if (filter === "failed") return groups.filter((g) => g.group_status === "failed");
    if (filter === "auth") return groups.filter((g) => g.group_status === "auth_required");
    return groups;
  }, [groups, filter]);

  const secretSaved = !!cronSecretCached;

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Queue</h1>
          <p style={{ opacity: 0.7 }}>予約の状態を確認できます（Threadsは必要に応じて「要対応」になります）。</p>
        </div>

        {/* 右上：管理者＋実行＋更新 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <label style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={adminMode} onChange={(e) => setAdminMode(e.target.checked)} />
            管理者モード
          </label>

          {adminMode ? (
            <>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                secret: {secretSaved ? "保存済み" : "未"}
              </span>

              <button onClick={saveSecret} style={btnStyle(true)}>
                secret保存
              </button>

              <button onClick={generateSecret} style={btnStyle(true)}>
                secret生成
              </button>

              <button onClick={deleteSecret} style={btnStyle(false, true)}>
                secret削除
              </button>

              <button onClick={runNow} style={btnStyle(true)} disabled={isRunningNow}>
                今すぐ実行
              </button>

              {/* 自動実行は管理者モードの時だけ表示 */}
              <label style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
                自動実行（1分）
              </label>
            </>
          ) : null}

          <button
            onClick={load}
            disabled={loading}
            aria-label="refresh"
            title="更新"
            style={{
              border: "1px solid #ddd",
              background: "#fff",
              borderRadius: 999,
              width: 36,
              height: 36,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              fontWeight: 700,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path
                d="M20 4v6h-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* フィルタ */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")} label={`All (${counts.all})`} />
        <FilterButton active={filter === "needs"} onClick={() => setFilter("needs")} label={`Needs Action (${counts.needs})`} />
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
          <div style={{ marginTop: 8, opacity: 0.7 }}>※ 未連携（x_user_id cookie無し）の場合は 401 になります</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {filtered.map((g) => {
          const isAuthRequired = g.group_status === "auth_required";
          const isNeeds = g.group_status === "needs_user_action";

          const xTweetUrl =
            g.x?.tweet_id && !isAuthRequired ? `https://x.com/i/web/status/${g.x.tweet_id}` : null;

          const idForDisplay = g.group_id ? `group:${g.group_id}` : `key:${g.group_key}`;

          const errText =
            g.group_status === "failed"
              ? short(g.items?.[0]?.last_error ?? "", 140)
              : g.group_status === "auth_required"
                ? short(g.items?.[0]?.last_error ?? "", 80)
                : "";

          return (
            <div key={g.group_key} style={cardStyle(g.group_status)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={badgeStyle(g.group_status)}>
                    {isNeeds ? "🔔" : null}
                    {statusLabel(g.group_status)}
                  </span>

                  <span style={{ fontSize: 12, opacity: 0.7 }}>to: {g.destinations.join(" + ")}</span>
                </div>

                <div style={{ opacity: 0.7, fontSize: 12, textAlign: "right" }}>
                  <div>{g.run_at ? new Date(g.run_at).toLocaleString("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})
</div>

                  <div
                    title={idForDisplay}
                    onClick={() => copyText(idForDisplay)}
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      opacity: 0.5,
                      cursor: "pointer",
                      userSelect: "none",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                    }}
                  >
                    {g.group_id ? `group_id: ${shortId(g.group_id)}` : `key: ${shortId(g.group_key)}`}（クリックでコピー）
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{g.display_text}</div>

              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  fontSize: 12,
                  opacity: 0.95,
                  alignItems: "center",
                }}
              >
                {/* X */}
                {xTweetUrl ? (
                  <a href={xTweetUrl} target="_blank" rel="noreferrer">
                    Xの投稿を開く
                  </a>
                ) : null}

                {isAuthRequired ? <a href="/accounts">Xを再連携する</a> : null}

                {(g.group_status === "failed" || g.group_status === "auth_required") && errText ? (
                  <span>error: {errText}</span>
                ) : null}

                {/* Threads 要対応 */}
                {isNeeds ? (
                  <>
                    <button onClick={() => copyText(g.threads?.text ?? g.display_text)} style={btnStyle()}>
                      本文コピー
                    </button>
                    <button onClick={openThreads} style={btnStyle()}>
                      Threadsを開く
                    </button>
                    <button onClick={() => completeThreads(g)} style={btnStyle(true)}>
                      完了にする
                    </button>
                  </>
                ) : null}

                {/* キャンセル */}
                {g.group_status === "pending" ||
                g.group_status === "running" ||
                g.group_status === "needs_user_action" ? (
                  <button onClick={() => cancelGroup(g)} style={btnStyle(false, true)}>
                    キャンセル
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && !error && filtered.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: 12 }}>
            {filter === "all"
              ? "まだ予約がありません。"
              : filter === "needs"
                ? "要対応（Threads）はありません。"
                : filter === "pending"
                  ? "Pending はありません。"
                  : filter === "failed"
                    ? "Failed はありません。"
                    : "Auth Required はありません。"}
          </div>
        ) : null}
      </div>

      {/* 右下トースト */}
      {copied ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 1000,
            border: "1px solid #ddd",
            background: "#fff",
            borderRadius: 14,
            padding: "10px 12px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">📋</span>
          <span>{copied}</span>
        </div>
      ) : null}
    </main>
  );
}

function btnStyle(primary = false, danger = false): CSSProperties {
  return {
    border: "1px solid #ddd",
    background: primary ? "#111" : "#fff",
    color: primary ? "#fff" : danger ? "#9b1c1c" : "#111",
    borderColor: danger ? "#ffb8b8" : "#ddd",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    opacity: 1,
  };
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
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
