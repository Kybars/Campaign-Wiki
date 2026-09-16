"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { VersionLink } from "@/components/version-link";

export function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isLibrary = pathname === "/campaigns";
  const navClass = (active: boolean) => `rounded-md px-3 py-2 text-sm font-semibold transition-colors ${active ? "bg-white/10 text-white" : "text-stone-300 hover:bg-white/10 hover:text-white"}`;

  return (
    <header className="border-b border-white/10 bg-[var(--night)] text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-6">
        <Link className="flex items-center gap-3 font-serif text-xl font-semibold tracking-tight hover:text-[var(--gold)]" href="/">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded border border-[var(--gold)]/70 text-sm text-[var(--gold)]">CW</span>
          Campaign Wiki
        </Link>
        <nav className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto" aria-label="Main navigation">
          <Link aria-current={isHome ? "page" : undefined} className={navClass(isHome)} href="/">Home</Link>
          <Link aria-current={isLibrary ? "page" : undefined} className={navClass(isLibrary)} href="/campaigns">Campaigns</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <VersionLink />
          <Link className="rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-bold text-[var(--night)] transition hover:bg-[#f0c875] focus:outline-none focus-visible:ring-2 focus-visible:ring-white" href="/#import">Import campaign</Link>
        </div>
      </div>
    </header>
  );
}
