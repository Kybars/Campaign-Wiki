import Link from "next/link";

export function WikiHeader({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  return (
    <header className="border-b border-[var(--line)] bg-white/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link className="font-serif text-xl font-bold" href={`/campaigns/${campaignId}`}>{campaignName}</Link>
        <nav className="flex items-center gap-5" aria-label="Campaign navigation">
          <Link className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--accent)]" href="/">Campaigns</Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href={`/campaigns/${campaignId}/search`}>Search</Link>
        </nav>
      </div>
    </header>
  );
}
