import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">ログイン処理中...</div>}>
      <AuthCallbackClient />
    </Suspense>
  );
}
