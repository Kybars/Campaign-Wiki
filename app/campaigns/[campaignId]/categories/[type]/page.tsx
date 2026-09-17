import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CategoryOrganizer } from "@/components/category-organizer";
import { EventChronology } from "@/components/event-chronology";
import { LocationTree } from "@/components/location-tree";
import { CampaignShell } from "@/components/wiki-header";
import { campaignHref, campaignViewMode, shouldRedirectHiddenPlayerPage } from "@/lib/campaign-view";
import { getCampaign, getCampaignEntities, getCampaignLocationHierarchy, getCampaignNavigation, getEventChronologyEntries } from "@/lib/db/queries";
import { ENTITY_TYPE_LABELS, isEntityType } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ campaignId: string; type: string }>; searchParams: Promise<{ view?: string; layout?: string }> }) {
  const { campaignId, type } = await params;
  const query = await searchParams;
  const viewMode = campaignViewMode(query.view);
  const isEnemiesView = type === "enemies";
  if (!isEnemiesView && !isEntityType(type)) notFound();
  let campaign;
  try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  const [entities, navigation, locationHierarchy, eventEntries] = await Promise.all([
    isEnemiesView ? getCampaignEntities(campaignId, undefined, "enemy", viewMode) : getCampaignEntities(campaignId, type, undefined, viewMode),
    getCampaignNavigation(campaignId, viewMode),
    type === "location" ? getCampaignLocationHierarchy(campaignId, viewMode) : Promise.resolve(undefined),
    type === "event" ? getEventChronologyEntries(campaignId, viewMode) : Promise.resolve([]),
  ]);
  if (shouldRedirectHiddenPlayerPage(viewMode, true, entities.length > 0)) redirect(`/campaigns/${campaignId}?view=player&notice=not-visible`);
  const title = isEnemiesView ? "Enemies" : ENTITY_TYPE_LABELS[type];
  const alternate = type === "location" ? "hierarchy" : type === "event" ? "chronology" : null;
  const useAlternate = query.layout === alternate;
  return <CampaignShell active={type} availableCategories={navigation} campaignId={campaignId} campaignName={campaign.name} currentPath={`/campaigns/${campaignId}/categories/${type}${useAlternate ? `?layout=${alternate}` : ""}`} viewMode={viewMode}>
    <main className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3"><h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">{title} <span className="font-sans text-sm font-normal text-[var(--muted)]">· {entities.length}</span></h1>{alternate ? <nav aria-label={`${title} organization`} className="flex rounded-md border border-[var(--line)] bg-white/55 p-0.5 text-xs font-semibold"><Link className={`rounded px-2.5 py-1.5 ${!useAlternate ? "bg-white text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`} href={campaignHref(`/campaigns/${campaignId}/categories/${type}`, viewMode)}>Board</Link><Link className={`rounded px-2.5 py-1.5 ${useAlternate ? "bg-white text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`} href={campaignHref(`/campaigns/${campaignId}/categories/${type}?layout=${alternate}`, viewMode)}>{alternate === "hierarchy" ? "Hierarchy" : "Chronology"}</Link></nav> : null}</div>
      {type === "quest" ? <CategoryOrganizer campaignId={campaignId} entries={entities} grouping="quest_status" key={`${campaignId}:${type}:quest_status:${viewMode}`} viewMode={viewMode} /> : useAlternate && type === "location" ? <section className="mt-8 rounded-xl border border-[var(--line)] bg-white/55 p-5"><LocationTree campaignId={campaignId} roots={locationHierarchy!.buildTree()} viewMode={viewMode} /></section> : useAlternate && type === "event" ? <section className="mt-8 rounded-xl border border-[var(--line)] bg-white/55 p-5"><EventChronology campaignId={campaignId} events={eventEntries} viewMode={viewMode} /></section> : <CategoryOrganizer campaignId={campaignId} entries={entities} key={`${campaignId}:${type}:prominence:${viewMode}`} viewMode={viewMode} />}
    </main>
  </CampaignShell>;
}
