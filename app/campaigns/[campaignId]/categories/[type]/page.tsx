import Link from "next/link";
import { notFound } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, getCampaignEntities } from "@/lib/db/queries";
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_SINGULAR_LABELS, hasEntityRole, isEntityType } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ campaignId: string; type: string }> }) {
  const { campaignId, type } = await params;
  const isEnemiesView = type === "enemies";
  if (!isEnemiesView && !isEntityType(type)) notFound();
  let campaign;
  try { campaign = await getCampaign(campaignId); } catch { notFound(); }
  const entities = isEnemiesView
    ? await getCampaignEntities(campaignId, undefined, "enemy")
    : await getCampaignEntities(campaignId, type);
  const title = isEnemiesView ? "Enemies" : ENTITY_TYPE_LABELS[type];
  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Link className="text-sm text-[var(--accent)]" href={`/campaigns/${campaignId}`}>← Campaign home</Link>
        <h1 className="mt-5 font-serif text-4xl font-semibold">{title}</h1>
        <p className="mt-2 text-[var(--muted)]">{entities.length} discovered</p>
        <ul className="mt-8 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {entities.map((entity) => (
            <li key={entity.id} className="py-4">
              <Link className="text-lg font-semibold hover:text-[var(--accent)]" href={`/campaigns/${campaignId}/entities/${entity.id}`}>{entity.name}</Link>
              {isEnemiesView ? <span className="ml-2 text-sm text-[var(--muted)]">{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span> : null}
              {hasEntityRole(entity, "enemy") ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Enemy</span> : null}
              {entity.summary ? <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{entity.summary}</p> : null}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
