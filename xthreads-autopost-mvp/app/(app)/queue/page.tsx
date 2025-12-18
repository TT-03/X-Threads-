export default function QueuePage() {
  return (
    <section className="space-y-4">
      <div className="rounded-3xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">予約（UIのみ）</div>
        <p className="mt-2 text-sm text-neutral-700">
          次段階で、DB + ジョブキュー（予約実行） + 失敗リトライ + ログを入れます。
        </p>

        <div className="mt-4 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-700">
          <div className="font-semibold">安全運用のための方針（初期）</div>
          <ul className="mt-1 list-disc pl-5">
            <li>デフォルトは下書き→確認→投稿（完全自動は後）</li>
            <li>1日の投稿数上限をユーザー側で設定</li>
            <li>強制的に「プレビュー」を挟むオプション</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
