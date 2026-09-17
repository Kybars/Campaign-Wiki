import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CampaignShell } from "@/components/wiki-header";
import { CampaignOverview } from "@/components/campaign-overview";
import { getCampaign, getCampaignEntities, getCampaignOverviewEvidence } from "@/lib/db/queries";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import { campaignHref, campaignViewMode, type CampaignViewMode } from "@/lib/campaign-view";
import { overviewCategoryCounts, overviewMetadata, overviewSummary, selectProminentOverviewEntries, selectQuestOverviewEntries, type OverviewEntry } from "@/lib/overview-selection";
import type { EntityType } from "@/lib/db/types";

export const dynamic = "force-dynamic";
const categoryOrder = ["npc", "location", "faction", "item", "quest", "event", "deity"] as const;
const extraTypes = ["item", "event", "deity", "other"] as const;
type CampaignEntry = Awaited<ReturnType<typeof getCampaignEntities>>[number];

function OverviewCard({ campaignId, entry, viewMode }: { campaignId: string; entry: OverviewEntry; viewMode: CampaignViewMode }) {
  const summary = overviewSummary(entry.summary);
  return <Link className="group flex flex-col rounded-md border border-[var(--line)] bg-white/35 px-3.5 py-2.5 transition-colors hover:border-[var(--accent)]/60 hover:bg-white/75 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2" href={campaignHref(`/campaigns/${campaignId}/entities/${entry.id}`, viewMode)}>
    <h3 className="font-serif text-lg font-semibold leading-tight text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">{entry.name}</h3>
    <p className="mt-1 text-xs font-medium text-[var(--muted)]">{overviewMetadata(entry)}</p>
    {summary ? <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-[var(--muted)]">{summary}</p> : null}
  </Link>;
}

function FeaturedSection({ campaignId, title, entries, type, viewMode }: { campaignId: string; title: string; entries: OverviewEntry[]; type: EntityType; viewMode: CampaignViewMode }) {
  if (!entries.length) return null;
  return <section className="border-t border-[var(--line)] pt-4" aria-labelledby={`${type}-overview-heading`}>
    <div className="flex items-baseline justify-between gap-3"><h2 className="font-serif text-xl font-semibold sm:text-2xl" id={`${type}-overview-heading`}>{title}</h2><Link className="shrink-0 text-xs font-semibold text-[var(--accent)] transition-colors hover:text-[var(--ink)] hover:underline focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:text-sm" href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)}>View all {ENTITY_TYPE_LABELS[type]} <span aria-hidden="true">→</span></Link></div>
    <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{entries.map((entry) => <OverviewCard campaignId={campaignId} entry={entry} key={entry.id} viewMode={viewMode} />)}</div>
  </section>;
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ view?: string; notice?: string }> }) {
  const { campaignId } = await params; const query = await searchParams; const viewMode = campaignViewMode(query.view);
  let campaign; try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  if (campaign.status !== "complete") redirect(`/campaigns/${campaignId}/processing`);
  const [entries, overviewEvidence] = await Promise.all([getCampaignEntities(campaignId, undefined, undefined, viewMode), getCampaignOverviewEvidence(campaignId, viewMode)]);
  const overviewEntries = entries as CampaignEntry[] as OverviewEntry[];
  const availableCategories = [...categoryOrder.filter((type) => entries.some((entry) => entry.type === type)), ...(entries.some((entry) => entry.roles.includes("enemy")) ? ["enemies"] : []), ...(entries.some((entry) => entry.type === "other") ? ["other"] : [])];
  const extraCategories = overviewCategoryCounts(overviewEntries, viewMode, extraTypes);
  return <CampaignShell active="home" availableCategories={availableCategories} campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode}>
    <main className="px-4 py-5 sm:px-6 sm:py-7">
      <div className="mx-auto w-full max-w-6xl">
      {viewMode === "player" && query.notice === "not-visible" ? <p className="mb-6 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--muted)]" role="status">This page isn&apos;t visible in Player View.</p> : null}
      <header className="pb-4"><h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{campaign.name}</h1><div className="mt-1 max-w-2xl"><CampaignOverview overview={campaign.overview} evidence={overviewEvidence} heading={false} /></div></header>
      {viewMode === "player" && entries.length === 0 ? <p className="rounded-lg border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--muted)]">This campaign does not currently have player-visible entries.</p> : null}
      <div className="space-y-4 sm:space-y-5">
        <FeaturedSection campaignId={campaignId} entries={selectProminentOverviewEntries(overviewEntries, "npc", viewMode)} title="Major NPCs" type="npc" viewMode={viewMode} />
        <FeaturedSection campaignId={campaignId} entries={selectProminentOverviewEntries(overviewEntries, "location", viewMode)} title="Major Locations" type="location" viewMode={viewMode} />
        <FeaturedSection campaignId={campaignId} entries={selectQuestOverviewEntries(overviewEntries, viewMode)} title="Ongoing Quests" type="quest" viewMode={viewMode} />
        <FeaturedSection campaignId={campaignId} entries={selectProminentOverviewEntries(overviewEntries, "faction", viewMode)} title="Major Factions" type="faction" viewMode={viewMode} />
        {extraCategories.length ? <section className="border-t border-[var(--line)] pt-4" aria-labelledby="more-to-explore-heading"><h2 className="font-serif text-xl font-semibold sm:text-2xl" id="more-to-explore-heading">More to explore</h2><div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{extraCategories.map(({ type, count }) => <Link className="group flex min-h-16 items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-white/30 px-3 py-2 transition-colors hover:border-[var(--accent)]/60 hover:bg-white/70 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2" href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)} key={type}><span><span className="block font-serif text-base font-semibold leading-tight text-[var(--ink)] transition-colors group-hover:text-[var(--accent)]">{ENTITY_TYPE_LABELS[type]}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{count} {count === 1 ? "entry" : "entries"}</span></span><span aria-hidden="true" className="text-sm text-[var(--accent)]">→</span></Link>)}</div></section> : null}
      </div>
      </div>
    </main>
  </CampaignShell>;
}
