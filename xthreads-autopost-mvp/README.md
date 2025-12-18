# X・Threads 自動投稿（MVP）(mobile-first)

スマホで使いやすい「下書き→予約→投稿」導線の最小プロトタイプです。

## できること（現状）
- ✅ X 連携（OAuth 2.0 Authorization Code + PKCE）
- ✅ 文章だけの投稿（POST /2/tweets）
- ✅ スマホ向けUI（ボトムナビ、タップ領域大きめ）
- ⏳ 予約投稿（UIのみ / DB+ジョブキューは次段階）
- ⏳ Threads 連携（次段階）

## セットアップ

```bash
# Node.js 20+ 推奨
npm i
cp .env.example .env.local
npm run dev
```

### X Developer Portal 側の設定
- Callback URL に `.env.local` の `X_REDIRECT_URI` を登録（**完全一致**）
- Scopes は最低 `tweet.write` を含める

## 実行
- 1) http://localhost:3000/app/accounts で「Xと連携する」
- 2) 連携後に /app/compose から「今すぐ投稿（X）」

## 注意
このMVPはアクセストークンを HttpOnly Cookie に保存しています（簡易実装）。  
本番では **DB保管 + 暗号化 + refresh token 管理 + 監査ログ** を入れてください。
