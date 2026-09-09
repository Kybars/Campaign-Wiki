import Link from "next/link";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";

const categoryLinks = [
  ["NPCs", "npc"], ["Deities", "deity"], ["Locations", "location"], ["Factions", "faction"], ["Items", "item"], ["Events", "event"], ["Quests", "quest"], ["Enemies", "enemies"], ["Other", "other"],
] as const;

export function WikiHeader({ campaignId, campaignName, viewMode = "dm", currentPath }: { campaignId: string; campaignName: string; viewMode?: CampaignViewMode; currentPath?: string }) {
  const href = (path: string) => campaignHref(path, viewMode);
  const modePath = currentPath ?? `/campaigns/${campaignId}`;
  return (
    <header className="border-b border-[var(--line)] bg-white/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link className="font-serif text-xl font-bold" href={href(`/campaigns/${campaignId}`)}>{campaignName}</Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2" aria-label="Campaign navigation">
          {categoryLinks.map(([label, type]) => <Link className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--accent)]" href={href(`/campaigns/${campaignId}/categories/${type}`)} key={type}>{label}</Link>)}
          <Link className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--accent)]" href="/">Campaigns</Link>
          <Link className="text-sm font-semibold text-[var(--accent)]" href={href(`/campaigns/${campaignId}/search`)}>Search</Link>
          <span className="flex rounded-md border border-[var(--line)] text-xs font-semibold" aria-label="Campaign preview mode">
            <Link aria-current={viewMode === "dm" ? "page" : undefined} className={`rounded-l px-2 py-1 ${viewMode === "dm" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`} href={campaignHref(modePath, "dm")}>DM View</Link>
            <Link aria-current={viewMode === "player" ? "page" : undefined} className={`rounded-r px-2 py-1 ${viewMode === "player" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`} href={campaignHref(modePath, "player")}>Player View</Link>
          </span>
        </nav>
      </div>
    </header>
  );
}
