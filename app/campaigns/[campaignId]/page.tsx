import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { CampaignOverview } from "@/components/campaign-overview";
import { getCampaign, getCampaignEntities, getCampaignOverviewEvidence } from "@/lib/db/queries";
import { ENTITY_TYPE_LABELS, ENTITY_TYPES, hasEntityRole } from "@/lib/entities";
import { campaignHref, campaignViewMode, type CampaignViewMode } from "@/lib/campaign-view";
import type { EntityRole, EntityType } from "@/lib/db/types";

export const dynamic = "force-dynamic";
const prominenceOrder = ["major", "supporting", "minor"] as const;
const categoryOrder = ["npc", "location", "faction", "item", "quest", "event", "deity"] as const;

type CampaignEntry = Awaited<ReturnType<typeof getCampaignEntities>>[number];

function ProminenceGroups({ campaignId, entries, viewMode, categoryPath, categoryLabel, role }: { campaignId: string; entries: CampaignEntry[]; viewMode: CampaignViewMode; categoryPath: string; categoryLabel: string; role?: EntityRole }) {
  const previewEntries = prominenceOrder.flatMap((prominence) => entries.filter((entry) => (entry.prominence ?? "supporting") === prominence)).slice(0, 10);
  return <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
    {prominenceOrder.filter((prominence) => previewEntries.some((entry) => (entry.prominence ?? "supporting") === prominence)).map((prominence) => {
      const grouped = previewEntries.filter((entry) => (entry.prominence ?? "supporting") === prominence);
      const label = prominence[0].toLocaleUpperCase("en-US") + prominence.slice(1);
      return <details key={prominence} open={prominence !== "minor"} className="rounded-lg bg-white/50 px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">{label} ({grouped.length})</summary>
        <ul className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-x-5 gap-y-1">{grouped.map((entry) => <li key={entry.id}><Link className="text-sm hover:text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/entities/${entry.id}`, viewMode)}>{entry.name}</Link>{role && hasEntityRole(entry, role) ? <span className="ml-2 text-xs text-[var(--muted)]">{ENTITY_TYPE_LABELS[entry.type]}</span> : null}</li>)}</ul>
      </details>;
    })}
    <Link className="mt-3 inline-block text-sm font-semibold text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/categories/${categoryPath}`, viewMode)}>Browse all {entries.length} {categoryLabel} →</Link>
  </div>;
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { campaignId } = await params; const viewMode = campaignViewMode((await searchParams).view);
  let campaign; try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  if (campaign.status !== "complete") redirect(`/campaigns/${campaignId}/processing`);
  const [entries, overviewEvidence] = await Promise.all([getCampaignEntities(campaignId, undefined, undefined, viewMode), getCampaignOverviewEvidence(campaignId, viewMode)]);
  const grouped = Object.fromEntries(ENTITY_TYPES.map((type) => [type, entries.filter((entry) => entry.type === type)])) as Record<EntityType, CampaignEntry[]>;
  const enemies = entries.filter((entry) => hasEntityRole(entry, "enemy"));
  return <>
    <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} active="home" />
    <main className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Campaign wiki</p>
      <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tight">{campaign.name} <span className="font-sans text-lg font-normal text-[var(--muted)]">({entries.length} {entries.length === 1 ? "entry" : "entries"})</span></h1>
      {viewMode === "player" && entries.length === 0 ? <p className="mt-4 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--muted)]">This campaign does not currently have player-visible entries. Switch to DM View to see the full wiki.</p> : null}
      <CampaignOverview overview={campaign.overview} evidence={overviewEvidence} />
      <section className="mt-10" aria-label="Campaign categories">
        <div className="grid gap-3">
          {categoryOrder.filter((type) => grouped[type].length > 0).map((type) => <details key={type} className="rounded-xl border border-[var(--line)] bg-white/60 p-4"><summary className="cursor-pointer font-serif text-xl font-semibold marker:text-[var(--accent)]">{ENTITY_TYPE_LABELS[type]} <span className="font-sans text-sm font-normal text-[var(--muted)]">({grouped[type].length})</span></summary><ProminenceGroups campaignId={campaignId} entries={grouped[type]} viewMode={viewMode} categoryPath={type} categoryLabel={ENTITY_TYPE_LABELS[type]} /></details>)}
          {enemies.length > 0 ? <details className="rounded-xl border border-[var(--line)] bg-white/60 p-4"><summary className="cursor-pointer font-serif text-xl font-semibold marker:text-[var(--accent)]">Enemies <span className="font-sans text-sm font-normal text-[var(--muted)]">({enemies.length})</span></summary><ProminenceGroups campaignId={campaignId} entries={enemies} viewMode={viewMode} categoryPath="enemies" categoryLabel="Enemies" role="enemy" /></details> : null}
          {grouped.other.length > 0 ? <details className="rounded-xl border border-[var(--line)] bg-white/60 p-4"><summary className="cursor-pointer font-serif text-xl font-semibold marker:text-[var(--accent)]">Other <span className="font-sans text-sm font-normal text-[var(--muted)]">({grouped.other.length})</span></summary><ProminenceGroups campaignId={campaignId} entries={grouped.other} viewMode={viewMode} categoryPath="other" categoryLabel="Other" /></details> : null}
        </div>
      </section>
    </main>
  </>;
}
