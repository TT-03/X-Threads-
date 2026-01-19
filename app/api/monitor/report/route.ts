import { NextResponse } from "next/server";
import { sendAlertEmail } from "../../../../lib/alertEmail";

/**
 * POST /api/monitor/report
 * - CRON から叩く「監視レポート」(成功なら {ok:true})
 * - 失敗時は run_monitor.sh 側から status/url/responseText を送ってメール通知も可能
 */
export async function POST(req: Request) {
  // 認証（Oracle側の cron secret と一致させる）
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // JSONボディは「ある時だけ読む」運用でOK（無くても落とさない）
  const body = await req.json().catch(() => ({} as any));

  // run_monitor.sh から「失敗レポート」を送る運用にしている場合
  // 例: { status: 401, url: "/api/schedule/run", responseText: "..." }
  if (body?.status && body?.url) {
    const subject = `[X-Threads] Cron error: ${body.status} (monitor)`;
    const text =
      `Cron failed.\n` +
      `status: ${body.status}\n` +
      `url: ${body.url}\n` +
      `body:\n${body?.responseText ?? ""}\n`;

    await sendAlertEmail(subject, text);
    return NextResponse.json({ ok: true, mode: "error-report" });
  }

  // 監視が「正常」だった時のレスポンス（今はここまででOK）
  return NextResponse.json({ ok: true, mode: "monitor" });
}
