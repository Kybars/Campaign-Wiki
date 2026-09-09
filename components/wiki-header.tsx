import Link from "next/link";
import { CampaignSearch } from "@/components/campaign-search";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";
import type { EntityType } from "@/lib/db/types";

const categoryLinks = [
  ["NPCs", "npc"], ["Deities", "deity"], ["Locations", "location"], ["Factions", "faction"], ["Items", "item"], ["Events", "event"], ["Quests", "quest"], ["Enemies", "enemies"], ["Other", "other"],
] as const;

export type CampaignNavKey = EntityType | "enemies" | "home" | "search";

export function WikiHeader({ campaignId, campaignName, viewMode = "dm", currentPath, active }: { campaignId: string; campaignName: string; viewMode?: CampaignViewMode; currentPath?: string; active?: CampaignNavKey }) {
  const href = (path: string) => campaignHref(path, viewMode);
  const modePath = currentPath ?? `/campaigns/${campaignId}`;
  const navClass = (key: CampaignNavKey) => `rounded-md px-2 py-1 text-sm font-semibold transition-colors ${active === key ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-white hover:text-[var(--accent)]"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color:var(--paper)]/95 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link aria-current={active === "home" ? "page" : undefined} className="min-w-0 truncate font-serif text-xl font-bold hover:text-[var(--accent)]" href={href(`/campaigns/${campaignId}`)}>{campaignName}</Link>
          <Link className="shrink-0 border-l border-[var(--line)] pl-4 text-sm font-semibold text-[var(--muted)] hover:text-[var(--accent)]" href="/">All Campaigns</Link>
          <div className="order-last w-full sm:order-none sm:ml-auto sm:w-72"><CampaignSearch campaignId={campaignId} viewMode={viewMode} /></div>
          <span className="flex shrink-0 rounded-md border border-[var(--line)] text-xs font-semibold" aria-label="Campaign preview mode">
            <Link aria-current={viewMode === "dm" ? "page" : undefined} className={`rounded-l px-2 py-1 ${viewMode === "dm" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`} href={campaignHref(modePath, "dm")}>DM View</Link>
            <Link aria-current={viewMode === "player" ? "page" : undefined} className={`rounded-r px-2 py-1 ${viewMode === "player" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`} href={campaignHref(modePath, "player")}>Player View</Link>
          </span>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Campaign navigation">
          {categoryLinks.map(([label, type]) => <Link aria-current={active === type ? "page" : undefined} className={navClass(type)} href={href(`/campaigns/${campaignId}/categories/${type}`)} key={type}>{label}</Link>)}
          <Link aria-current={active === "search" ? "page" : undefined} className={navClass("search")} href={href(`/campaigns/${campaignId}/search`)}>Search</Link>
        </nav>
      </div>
    </header>
  );
}
