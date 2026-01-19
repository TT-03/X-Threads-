import { getCookie } from "../_lib/cookies";

// x_user_id（cookie）の値で管理者判定する版（外部ライブラリ不要）
export async function requireAdmin() {
  const userId = await getCookie("x_user_id");
  if (!userId) {
    return { ok: false as const, status: 401, reason: "Missing x_user_id cookie" };
  }

  const admins = (process.env.ADMIN_X_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isAdmin = admins.includes(userId);

  if (!isAdmin) {
    return { ok: false as const, status: 403, reason: "Not admin" };
  }

  return { ok: true as const, status: 200, userId };
}
