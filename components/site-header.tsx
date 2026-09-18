"use client";

import Link from "next/link";
import { VersionLink } from "@/components/version-link";

export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-[var(--night)] text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-6">
        <Link className="flex items-center gap-3 font-serif text-xl font-semibold tracking-tight hover:text-[var(--gold)]" href="/">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded border border-[var(--gold)]/70 text-sm text-[var(--gold)]">CW</span>
          Campaign Wiki
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <VersionLink />
          <Link className="rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-bold text-[var(--night)] transition hover:bg-[#f0c875] focus:outline-none focus-visible:ring-2 focus-visible:ring-white" href="/import">Import campaign</Link>
        </div>
      </div>
    </header>
  );
}
