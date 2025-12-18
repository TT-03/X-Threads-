export default function SettingsPage() {
  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">設定</div>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3">
          <div className="text-xs font-semibold text-neutral-700">プラン（仮）</div>
          <div className="mt-1 text-sm text-neutral-700">
            Free: 下書き・手動投稿（制限あり） / Pro: 要約→投稿化 / Advanced: 拡張機能
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3">
          <div className="text-xs font-semibold text-neutral-700">クレジット（仮）</div>
          <div className="mt-1 text-sm text-neutral-700">
            ここに「残りクレジット」や利用履歴を表示予定。
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-700">
          <div className="font-semibold">MVPの次の実装</div>
          <ol className="mt-1 list-decimal pl-5">
            <li>ユーザー認証（メール/Apple/Googleなど）</li>
            <li>DB保管（トークン暗号化、予約、履歴）</li>
            <li>ジョブキュー（予約投稿、失敗時リトライ）</li>
            <li>課金（Stripe）とプラン制御</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
