import { cookies } from "next/headers";

// x_user_id(cookie)の値で管理者判定する版（外部ファイル不要）
export async function requireAdmin() {
  const userId = cookies().get("x_user_id")?.value;

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
