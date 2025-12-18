import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh px-5 pb-10 pt-12">
      <div className="mx-auto max-w-md">
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold leading-tight">
            X・Threads 自動投稿（MVP）
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-700">
            スマホ前提のUI。まずは<strong>下書き</strong>と<strong>予約</strong>中心で安全に運用できる形から始めます。
          </p>

          <div className="mt-6 space-y-3">
            <Link
              className="block w-full rounded-2xl bg-neutral-900 px-4 py-3 text-center text-sm font-semibold text-white active:scale-[0.99]"
              href="/app/compose"
            >
              はじめる
            </Link>
            <Link className="block text-center text-sm" href="/app/accounts">
              アカウント連携へ
            </Link>
          </div>

          <div className="mt-7 rounded-2xl bg-neutral-50 p-4">
            <div className="text-xs font-semibold text-neutral-700">MVPの狙い</div>
            <ul className="mt-2 list-disc pl-5 text-sm text-neutral-700">
              <li>まずは自動投稿より「誤爆しない」導線</li>
              <li>OAuth（Xログイン）で投稿権限を安全に取得</li>
              <li>スマホで片手操作できるボトムナビ</li>
            </ul>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-500">
          ※ プロトタイプです。実運用ではDB保管・暗号化・監査ログが必要です。
        </p>
      </div>
    </main>
  );
}
