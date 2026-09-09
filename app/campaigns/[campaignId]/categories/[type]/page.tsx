import Link from "next/link";
import { notFound } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { LocationTree } from "@/components/location-tree";
import { getCampaign, getCampaignEntities, getCampaignLocationHierarchy } from "@/lib/db/queries";
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_SINGULAR_LABELS, hasEntityRole, isEntityType } from "@/lib/entities";
import { campaignHref, campaignViewMode } from "@/lib/campaign-view";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ campaignId: string; type: string }>; searchParams: Promise<{ view?: string }> }) {
  const { campaignId, type } = await params;
  const viewMode = campaignViewMode((await searchParams).view);
  const isEnemiesView = type === "enemies";
  if (!isEnemiesView && !isEntityType(type)) notFound();
  let campaign;
  try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  const [entities, locationHierarchy] = await Promise.all([
    type === "location" ? Promise.resolve([]) : isEnemiesView
      ? getCampaignEntities(campaignId, undefined, "enemy", viewMode)
      : getCampaignEntities(campaignId, type, undefined, viewMode),
    type === "location" ? getCampaignLocationHierarchy(campaignId, viewMode) : Promise.resolve(undefined),
  ]);
  const title = isEnemiesView ? "Enemies" : ENTITY_TYPE_LABELS[type];
  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} currentPath={`/campaigns/${campaignId}/categories/${type}`} />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Link className="text-sm text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}`, viewMode)}>← Campaign home</Link>
        <h1 className="mt-5 font-serif text-4xl font-semibold">{title}</h1>
        <p className="mt-2 text-[var(--muted)]">{type === "location" ? locationHierarchy!.getRoots().length : entities.length} {type === "location" ? "top-level location" : "discovered"}{type === "location" && locationHierarchy!.getRoots().length === 1 ? "" : type === "location" ? "s" : ""}</p>
        {type === "location" ? <div className="mt-8 border-y border-[var(--line)] py-4"><LocationTree campaignId={campaignId} roots={locationHierarchy!.buildTree()} viewMode={viewMode} /></div> : <ul className="mt-8 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {entities.map((entity) => (
            <li key={entity.id} className="py-4">
              <Link className="text-lg font-semibold hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)}>{entity.name}</Link>
              {isEnemiesView ? <span className="ml-2 text-sm text-[var(--muted)]">{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span> : null}
              {hasEntityRole(entity, "enemy") ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Enemy</span> : null}
              {entity.summary ? <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{entity.summary}</p> : null}
            </li>
          ))}
          {entities.length === 0 ? <li className="py-4 text-[var(--muted)]">No {isEnemiesView ? "enemies" : title.toLocaleLowerCase("en-US")} have been discovered yet.</li> : null}
        </ul>}
      </main>
    </>
  );
}
