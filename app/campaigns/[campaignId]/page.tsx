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
  return <Link className="group flex min-h-28 flex-col rounded-lg border border-[var(--line)] bg-white/60 px-4 py-3 shadow-sm transition hover:border-[var(--accent)] hover:bg-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entry.id}`, viewMode)}>
    <h3 className="font-serif text-lg font-semibold leading-tight group-hover:text-[var(--accent)]">{entry.name}</h3>
    <p className="mt-1 text-xs font-semibold text-[var(--muted)]">{overviewMetadata(entry)}</p>
    {summary ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--muted)]">{summary}</p> : null}
  </Link>;
}

function FeaturedSection({ campaignId, title, entries, type, viewMode }: { campaignId: string; title: string; entries: OverviewEntry[]; type: EntityType; viewMode: CampaignViewMode }) {
  if (!entries.length) return null;
  return <section className="border-t border-[var(--line)] pt-5" aria-labelledby={`${type}-overview-heading`}>
    <div className="flex items-baseline justify-between gap-4"><h2 className="font-serif text-2xl font-semibold" id={`${type}-overview-heading`}>{title}</h2><Link className="shrink-0 text-sm font-semibold text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)}>View all {ENTITY_TYPE_LABELS[type]} <span aria-hidden="true">→</span></Link></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{entries.map((entry) => <OverviewCard campaignId={campaignId} entry={entry} key={entry.id} viewMode={viewMode} />)}</div>
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
      {viewMode === "player" && query.notice === "not-visible" ? <p className="mb-6 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--muted)]" role="status">This page isn&apos;t visible in Player View.</p> : null}
      <header className="max-w-3xl pb-5"><h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{campaign.name}</h1><CampaignOverview overview={campaign.overview} evidence={overviewEvidence} heading={false} /></header>
      {viewMode === "player" && entries.length === 0 ? <p className="rounded-lg border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--muted)]">This campaign does not currently have player-visible entries.</p> : null}
      <div className="space-y-6">
        <FeaturedSection campaignId={campaignId} entries={selectProminentOverviewEntries(overviewEntries, "npc", viewMode)} title="Major NPCs" type="npc" viewMode={viewMode} />
        <FeaturedSection campaignId={campaignId} entries={selectProminentOverviewEntries(overviewEntries, "location", viewMode)} title="Major Locations" type="location" viewMode={viewMode} />
        <FeaturedSection campaignId={campaignId} entries={selectQuestOverviewEntries(overviewEntries, viewMode)} title="Ongoing Quests" type="quest" viewMode={viewMode} />
        <FeaturedSection campaignId={campaignId} entries={selectProminentOverviewEntries(overviewEntries, "faction", viewMode)} title="Major Factions" type="faction" viewMode={viewMode} />
        {extraCategories.length ? <section className="border-t border-[var(--line)] pt-5" aria-labelledby="more-to-explore-heading"><h2 className="font-serif text-2xl font-semibold" id="more-to-explore-heading">More to explore</h2><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{extraCategories.map(({ type, count }) => <Link className="text-sm font-semibold text-[var(--accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)} key={type}>{ENTITY_TYPE_LABELS[type]} <span className="font-normal text-[var(--muted)]">({count})</span></Link>)}</div></section> : null}
      </div>
    </main>
  </CampaignShell>;
}
