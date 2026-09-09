import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, getCampaignEntities, getCampaignLocationHierarchy } from "@/lib/db/queries";
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, hasEntityRole } from "@/lib/entities";
import { locationOverview } from "@/lib/locations/presentation";
import { campaignHref, campaignViewMode } from "@/lib/campaign-view";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { campaignId } = await params;
  const viewMode = campaignViewMode((await searchParams).view);
  let campaign;
  try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  if (campaign.status !== "complete") redirect(`/campaigns/${campaignId}/processing`);
  const [entities, locationHierarchy] = await Promise.all([getCampaignEntities(campaignId, undefined, undefined, viewMode), getCampaignLocationHierarchy(campaignId, viewMode)]);
  const grouped = Object.fromEntries(ENTITY_TYPES.map((type) => [type, entities.filter((entity) => entity.type === type)]));
  const enemies = entities.filter((entity) => hasEntityRole(entity, "enemy"));

  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Campaign wiki</p>
        <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tight">{campaign.name}</h1>
        <p className="mt-3 text-lg text-[var(--muted)]">{entities.length} {entities.length === 1 ? "entity" : "entities"} discovered</p>

        <form className="mt-8" action={`/campaigns/${campaignId}/search`}>
          {viewMode === "player" ? <input type="hidden" name="view" value="player" /> : null}
          <label className="sr-only" htmlFor="campaign-search">Search campaign</label>
          <div className="flex max-w-xl gap-2">
            <input id="campaign-search" name="q" placeholder="Search names and aliases…" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]" />
            <button className="rounded-lg bg-[var(--ink)] px-5 py-3 font-semibold text-white">Search</button>
          </div>
        </form>

        <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9" aria-label="Entity counts">
          {ENTITY_TYPES.map((type) => (
            <Link key={type} href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)} className="rounded-xl border border-[var(--line)] bg-white/60 p-4 hover:border-[var(--accent)]">
              <span className="block text-2xl font-bold">{grouped[type].length}</span>
              <span className="text-sm text-[var(--muted)]">{ENTITY_TYPE_LABELS[type]}</span>
            </Link>
          ))}
          <Link href={campaignHref(`/campaigns/${campaignId}/categories/enemies`, viewMode)} className="rounded-xl border border-[var(--line)] bg-white/60 p-4 hover:border-[var(--accent)]">
            <span className="block text-2xl font-bold">{enemies.length}</span>
            <span className="text-sm text-[var(--muted)]">Enemies</span>
          </Link>
        </section>

        <div className="mt-14 grid gap-12 md:grid-cols-2">
          {ENTITY_TYPES.filter((type) => type !== "location" && grouped[type].length > 0).map((type) => (
            <section key={type}>
              <div className="mb-4 flex items-baseline justify-between border-b border-[var(--line)] pb-2">
                <h2 className="font-serif text-2xl font-semibold">{ENTITY_TYPE_LABELS[type]}</h2>
                <Link className="text-sm text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)}>View all</Link>
              </div>
              <ul className="space-y-2">
                {grouped[type].map((entity) => (
                  <li key={entity.id} className="flex flex-wrap items-center gap-2">
                    <Link className="hover:text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)}>{entity.name}</Link>
                    {hasEntityRole(entity, "enemy") ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Enemy</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="md:col-span-2">
            <div className="mb-4 flex items-baseline justify-between border-b border-[var(--line)] pb-2">
              <h2 className="font-serif text-2xl font-semibold">Locations</h2>
              <Link className="text-sm text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/categories/location`, viewMode)}>View all locations</Link>
            </div>
            {locationHierarchy.getRoots().length === 0 ? <p className="text-[var(--muted)]">No locations have been discovered yet.</p> : (
              <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {locationOverview(locationHierarchy).map(({ location, immediateChildCount }) => {
                  return <li key={location.id}><Link className="font-semibold hover:text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/entities/${location.id}`, viewMode)}>{location.name}</Link>{immediateChildCount ? <span className="ml-2 text-sm text-[var(--muted)]">{immediateChildCount} {immediateChildCount === 1 ? "sublocation" : "sublocations"}</span> : null}</li>;
                })}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
