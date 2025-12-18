import Link from "next/link";

export default function AccountsPage() {
  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">アカウント連携</div>
        <p className="mt-2 text-sm text-neutral-700">
          まずはX連携（OAuth 2.0 + PKCE）を実装済み。Threadsは次段階で追加します。
        </p>

        <div className="mt-4 space-y-2">
          <a
            className="block w-full rounded-2xl bg-neutral-900 px-4 py-3 text-center text-sm font-semibold text-white"
            href="/api/auth/x/start"
          >
            Xと連携する（OAuth）
          </a>

          <button
            className="block w-full rounded-2xl bg-neutral-100 px-4 py-3 text-center text-sm font-semibold text-neutral-700"
            disabled
          >
            Threadsと連携（準備中）
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-700">
          <div className="font-semibold">連携ができないとき</div>
          <ul className="mt-1 list-disc pl-5">
            <li>X Developer PortalでCallback URLが「完全一致」になっているか確認</li>
            <li>.env.local の X_CLIENT_ID / X_CLIENT_SECRET / X_REDIRECT_URI を確認</li>
          </ul>
        </div>

        <div className="mt-4 text-xs text-neutral-500">
          OAuth成功後は /api/x/tweet が使えるようになります。
        </div>

        <div className="mt-3 text-xs">
          <Link href="/app/compose">→ 作成画面へ</Link>
        </div>
      </div>
    </section>
  );
}
