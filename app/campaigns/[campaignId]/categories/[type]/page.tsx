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
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} currentPath={`/campaigns/${campaignId}/categories/${type}`} active={type} />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Link className="text-sm text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}`, viewMode)}>← Campaign home</Link>
        <h1 className="mt-5 font-serif text-4xl font-semibold">{title}</h1>
        <p className="mt-2 text-[var(--muted)]">{type === "location" ? locationHierarchy!.getRoots().length : entities.length} {type === "location" ? "top-level location" : "entries"}{type === "location" && locationHierarchy!.getRoots().length === 1 ? "" : type === "location" ? "s" : ""}</p>
        {type === "location" ? <div className="mt-8 border-y border-[var(--line)] py-4"><LocationTree campaignId={campaignId} roots={locationHierarchy!.buildTree()} viewMode={viewMode} /></div> : <div className="mt-8 space-y-8">
          {(["major", "supporting", "minor"] as const).map((prominence) => {
            const entries = entities.filter((entity) => (entity.prominence ?? "supporting") === prominence);
            const label = prominence === "major" ? "Major" : prominence === "supporting" ? "Supporting" : "Minor";
            return <details key={prominence} open className="group"><summary className="cursor-pointer font-serif text-2xl font-semibold marker:text-[var(--accent)]">{label} <span className="font-sans text-sm font-normal text-[var(--muted)]">({entries.length})</span></summary><ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {entries.map((entity) => (
            <li key={entity.id} className="py-4">
              <Link className="text-lg font-semibold hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)}>{entity.name}</Link>
              {isEnemiesView ? <span className="ml-2 text-sm text-[var(--muted)]">{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span> : null}
              {hasEntityRole(entity, "enemy") ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Enemy</span> : null}
              {entity.summary ? <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{entity.summary}</p> : null}
            </li>
          ))}
          {entries.length === 0 ? <li className="py-4 text-[var(--muted)]">No {label.toLocaleLowerCase("en-US")} entries.</li> : null}
            </ul></details>;
          })}
          {entities.length === 0 ? <p className="text-[var(--muted)]">No {isEnemiesView ? "enemies" : title.toLocaleLowerCase("en-US")} have been discovered yet.</p> : null}
        </div>}
      </main>
    </>
  );
}
