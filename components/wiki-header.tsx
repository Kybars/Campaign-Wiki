"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { CampaignSearch } from "@/components/campaign-search";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";
import type { EntityType } from "@/lib/db/types";

const categoryLinks = [
  ["NPCs", "npc"], ["Locations", "location"], ["Factions", "faction"], ["Items", "item"], ["Quests", "quest"], ["Events", "event"], ["Deities", "deity"], ["Enemies", "enemies"], ["Other", "other"],
] as const;

export type CampaignNavKey = EntityType | "enemies" | "home" | "search";

type CampaignShellProps = {
  campaignId: string;
  campaignName: string;
  viewMode?: CampaignViewMode;
  currentPath?: string;
  active?: CampaignNavKey;
  availableCategories?: string[];
  children?: ReactNode;
};

function ViewModeSwitch({ currentPath, viewMode }: { currentPath: string; viewMode: CampaignViewMode }) {
  return <span className="flex w-fit rounded-md border border-[var(--line)] bg-white/60 text-xs font-semibold" aria-label="Campaign preview mode">
    <Link aria-current={viewMode === "dm" ? "page" : undefined} className={`rounded-l px-2.5 py-1.5 ${viewMode === "dm" ? "bg-white text-[var(--accent)] shadow-sm" : "text-[var(--muted)] hover:bg-white"}`} href={campaignHref(currentPath, "dm")}>DM</Link>
    <Link aria-current={viewMode === "player" ? "page" : undefined} className={`rounded-r px-2.5 py-1.5 ${viewMode === "player" ? "bg-white text-[var(--accent)] shadow-sm" : "text-[var(--muted)] hover:bg-white"}`} href={campaignHref(currentPath, "player")}>Player</Link>
  </span>;
}

function CampaignLinks({ active, campaignId, onNavigate, viewMode, availableCategories }: { active?: CampaignNavKey; campaignId: string; onNavigate?: () => void; viewMode: CampaignViewMode; availableCategories?: string[] }) {
  const href = (path: string) => campaignHref(path, viewMode);
  const linkClass = (key: CampaignNavKey) => `block rounded-md px-3 py-2 text-sm font-semibold transition-colors ${active === key ? "bg-white text-[var(--accent)] shadow-sm ring-1 ring-[var(--line)]" : "text-[var(--muted)] hover:bg-white/75 hover:text-[var(--accent)]"}`;
  return <nav aria-label="Campaign navigation" className="space-y-1">
    <Link aria-current={active === "home" ? "page" : undefined} className={linkClass("home")} href={href(`/campaigns/${campaignId}`)} onClick={onNavigate}>Overview</Link>
    {categoryLinks.filter(([, type]) => viewMode === "dm" || availableCategories?.includes(type)).map(([label, type]) => <Link aria-current={active === type ? "page" : undefined} className={linkClass(type)} href={href(`/campaigns/${campaignId}/categories/${type}`)} key={type} onClick={onNavigate}>{label}</Link>)}
  </nav>;
}

export function CampaignShell({ campaignId, campaignName, viewMode = "dm", currentPath, active, availableCategories, children }: CampaignShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerId = useId();
  const modePath = currentPath ?? `/campaigns/${campaignId}`;
  const activeLabel = active === "home" ? "Overview" : active === "search" ? "Campaign navigation" : categoryLinks.find(([, key]) => key === active)?.[0] ?? "Campaign navigation";

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return <div className="mx-auto max-w-[100rem] lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-5 lg:px-5 xl:gap-7">
    <aside className="hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)] lg:overflow-y-auto lg:border-r lg:border-[var(--line)] lg:py-6 lg:pr-5">
      <Link className="block truncate font-serif text-xl font-semibold hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}`, viewMode)}>{campaignName}</Link>
      <div className="mt-3"><CampaignSearch campaignId={campaignId} viewMode={viewMode} /></div>
      <div className="mt-4"><ViewModeSwitch currentPath={modePath} viewMode={viewMode} /></div>
      <div className="mt-5 border-t border-[var(--line)] pt-4"><CampaignLinks active={active} availableCategories={availableCategories} campaignId={campaignId} viewMode={viewMode} /></div>
    </aside>
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 lg:hidden">
        <button aria-controls={drawerId} aria-expanded={mobileOpen} className="rounded-md border border-[var(--line)] bg-white/65 px-3 py-2 text-sm font-semibold hover:bg-white" onClick={() => setMobileOpen(true)} type="button">{activeLabel} <span aria-hidden="true">▾</span></button>
        <ViewModeSwitch currentPath={modePath} viewMode={viewMode} />
      </div>
      {mobileOpen ? <div className="fixed inset-0 z-50 lg:hidden" id={drawerId} role="dialog" aria-modal="true" aria-label="Campaign navigation">
        <button aria-label="Close campaign navigation" className="absolute inset-0 cursor-default bg-black/25" onClick={() => setMobileOpen(false)} type="button" />
        <section className="relative h-full w-[min(22rem,88vw)] overflow-y-auto border-r border-[var(--line)] bg-[var(--paper)] p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3"><Link className="min-w-0 truncate font-serif text-xl font-semibold" href={campaignHref(`/campaigns/${campaignId}`, viewMode)} onClick={() => setMobileOpen(false)}>{campaignName}</Link><button className="rounded px-2 py-1 text-sm font-semibold text-[var(--muted)] hover:bg-white" onClick={() => setMobileOpen(false)} type="button">Close</button></div>
          <div className="mt-4"><CampaignSearch autoFocus campaignId={campaignId} viewMode={viewMode} /></div>
          <div className="mt-5 border-t border-[var(--line)] pt-4"><CampaignLinks active={active} availableCategories={availableCategories} campaignId={campaignId} onNavigate={() => setMobileOpen(false)} viewMode={viewMode} /></div>
        </section>
      </div> : null}
      {children}
    </div>
  </div>;
}
