import { cookies } from "next/headers";

// x_user_id(cookie)の値で管理者判定（Next.js 16対応：cookies() は await が必要）
export async function requireAdmin() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("x_user_id")?.value;

  if (!userId) {
    return { ok: false as const, status: 401, reason: "Missing x_user_id cookie" };
  }

  const admins = (process.env.ADMIN_X_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!admins.includes(userId)) {
    return { ok: false as const, status: 403, reason: "Not admin" };
  }

  return { ok: true as const, status: 200, userId };
}
