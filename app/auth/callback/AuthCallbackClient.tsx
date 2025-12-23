"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function safeNext(next: string | null) {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/app/compose";
}

export default function AuthCallbackClient() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const token_hash = sp.get("token_hash");
    const type = sp.get("type") as
      | "signup"
      | "magiclink"
      | "recovery"
      | "invite"
      | "email_change"
      | null;

    const code = sp.get("code");
    const next = safeNext(sp.get("next"));

    (async () => {
      try {
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (error) throw error;
          router.replace(next);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          router.replace(next);
          return;
        }

        throw new Error("Missing token_hash/type or code");
      } catch (e) {
        router.replace(
          "/auth/error?m=" +
            encodeURIComponent("認証に失敗しました。もう一度メールのリンクからやり直してください。")
        );
      }
    })();
  }, [router, sp]);

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">ログイン処理中...</div>
        <p className="mt-2 text-sm text-neutral-700">数秒お待ちください</p>
      </div>
    </main>
  );
}
