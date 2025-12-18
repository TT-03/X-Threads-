export async function GET() {
  return Response.json({ ok: true, name: "xthreads-autopost-mvp", ts: new Date().toISOString() });
}
