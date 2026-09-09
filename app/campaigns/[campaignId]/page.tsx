import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, getCampaignEntities, getCampaignLocationHierarchy } from "@/lib/db/queries";
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, hasEntityRole } from "@/lib/entities";
import { locationOverview } from "@/lib/locations/presentation";
import { campaignHref, campaignViewMode } from "@/lib/campaign-view";

export const dynamic = "force-dynamic";
const prominenceOrder = ["major", "supporting", "minor"] as const;
const previewLimit = 6;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { campaignId } = await params; const viewMode = campaignViewMode((await searchParams).view);
  let campaign; try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  if (campaign.status !== "complete") redirect(`/campaigns/${campaignId}/processing`);
  const [entities, locationHierarchy] = await Promise.all([getCampaignEntities(campaignId, undefined, undefined, viewMode), getCampaignLocationHierarchy(campaignId, viewMode)]);
  const grouped = Object.fromEntries(ENTITY_TYPES.map((type) => [type, entities.filter((entity) => entity.type === type)]));
  const enemies = entities.filter((entity) => hasEntityRole(entity, "enemy"));
  const featured = prominenceOrder.flatMap((prominence) => entities.filter((entity) => (entity.prominence ?? "supporting") === prominence)).slice(0, previewLimit);
  const categoryOrder = ["npc", "location", "faction", "quest", "event", "item", "deity", "other"] as const;
  return <>
    <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} active="home" />
    <main className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Campaign wiki</p>
      <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tight">{campaign.name}</h1>
      <p className="mt-3 text-lg text-[var(--muted)]">{entities.length} {entities.length === 1 ? "entry" : "entries"} discovered</p>
      <section className="mt-10 grid gap-5 lg:grid-cols-[1.4fr_1fr]" aria-label="Campaign discovery">
        <div className="rounded-xl border border-[var(--line)] bg-white/60 p-5"><div className="flex items-baseline justify-between gap-3"><h2 className="font-serif text-2xl font-semibold">Featured entries</h2><span className="text-sm text-[var(--muted)]">Major and supporting</span></div>
          {featured.length ? <ul className="mt-4 grid gap-2 sm:grid-cols-2">{featured.map((entity) => <li key={entity.id}><Link className="block rounded-lg px-3 py-2 hover:bg-[var(--paper)] hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)}><span className="font-semibold">{entity.name}</span><span className="ml-2 text-xs text-[var(--muted)]">{ENTITY_TYPE_LABELS[entity.type]}</span></Link></li>)}</ul> : <p className="mt-4 text-[var(--muted)]">No featured entries have been discovered yet.</p>}
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-white/60 p-5"><h2 className="font-serif text-2xl font-semibold">Browse by category</h2><ul className="mt-4 grid grid-cols-2 gap-2">{categoryOrder.map((type) => <li key={type}><Link className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--paper)] hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)}><span>{ENTITY_TYPE_LABELS[type]}</span><span className="font-semibold">{grouped[type].length}</span></Link></li>)}<li><Link className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--paper)] hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/categories/enemies`, viewMode)}><span>Enemies</span><span className="font-semibold">{enemies.length}</span></Link></li></ul></div>
      </section>
      <section className="mt-12" aria-labelledby="locations-heading"><div className="mb-4 flex items-baseline justify-between border-b border-[var(--line)] pb-2"><h2 id="locations-heading" className="font-serif text-2xl font-semibold">Locations</h2><Link className="text-sm text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/categories/location`, viewMode)}>Browse all locations</Link></div>
        {locationHierarchy.getRoots().length === 0 ? <p className="text-[var(--muted)]">No locations have been discovered yet.</p> : <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{locationOverview(locationHierarchy).slice(0, previewLimit).map(({ location, immediateChildCount }) => <li key={location.id}><Link className="font-semibold hover:text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/entities/${location.id}`, viewMode)}>{location.name}</Link>{immediateChildCount ? <span className="ml-2 text-sm text-[var(--muted)]">{immediateChildCount} {immediateChildCount === 1 ? "sublocation" : "sublocations"}</span> : null}</li>)}</ul>}
      </section>
    </main>
  </>;
}
