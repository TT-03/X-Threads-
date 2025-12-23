// app/auth/callback/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    // Supabaseのメールリンクは token_hash + type をクエリに付けることが多い
    // （古い形式だと access_token 等が付くケースもあるので両対応）
    const token_hash = sp.get("token_hash");
    const type = sp.get("type") as any; // "signup" / "magiclink" / "recovery" etc
    const next = sp.get("next") || "/app/compose";

    (async () => {
      try {
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type,
          });
          if (error) throw error;
        } else {
          // もしURLに access_token が載るタイプの場合でも
          // Supabase JS はURLからのセッション復元が効くことがあるので
          // ここは何もしない（必要なら後で補強）
        }

        router.replace(next);
      } catch (e) {
        router.replace(`/auth/error?m=${encodeURIComponent("認証に失敗しました。もう一度やり直してください。")}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">ログイン処理中…</div>
        <p className="mt-2 text-sm text-neutral-700">数秒お待ちください。</p>
      </div>
    </main>
  );
}
