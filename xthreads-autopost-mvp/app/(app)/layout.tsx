import Link from "next/link";

const tabs = [
  { href: "/app/compose", label: "作成" },
  { href: "/app/queue", label: "予約" },
  { href: "/app/accounts", label: "連携" },
  { href: "/app/settings", label: "設定" },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <div className="text-sm font-semibold">X・Threads 自動投稿（MVP）</div>
          <a className="text-xs text-neutral-500" href="/api/health">
            health
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/90 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-2xl px-2 py-2 text-center text-xs font-semibold text-neutral-700 active:bg-neutral-100"
            >
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
