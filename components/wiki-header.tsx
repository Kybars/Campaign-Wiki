import Link from "next/link";

const categoryLinks = [
  ["NPCs", "npc"], ["Deities", "deity"], ["Locations", "location"], ["Factions", "faction"], ["Items", "item"], ["Events", "event"], ["Quests", "quest"], ["Enemies", "enemies"], ["Other", "other"],
] as const;

export function WikiHeader({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  return (
    <header className="border-b border-[var(--line)] bg-white/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link className="font-serif text-xl font-bold" href={`/campaigns/${campaignId}`}>{campaignName}</Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2" aria-label="Campaign navigation">
          {categoryLinks.map(([label, type]) => <Link className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--accent)]" href={`/campaigns/${campaignId}/categories/${type}`} key={type}>{label}</Link>)}
          <Link className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--accent)]" href="/">Campaigns</Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href={`/campaigns/${campaignId}/search`}>Search</Link>
        </nav>
      </div>
    </header>
  );
}
