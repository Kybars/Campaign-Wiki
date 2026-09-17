import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignShell } from "@/components/wiki-header";
import { getCampaign, getCampaignNavigation, searchCampaignEntities } from "@/lib/db/queries";
import { ENTITY_TYPE_SINGULAR_LABELS, hasEntityRole } from "@/lib/entities";
import { campaignHref, campaignViewMode } from "@/lib/campaign-view";

export const dynamic = "force-dynamic";

export default async function SearchPage({ params, searchParams }: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { campaignId } = await params;
  const { q = "", view } = await searchParams;
  const viewMode = campaignViewMode(view);
  let campaign;
  try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  const [results, navigation] = await Promise.all([q.trim() ? searchCampaignEntities(campaignId, q, viewMode) : Promise.resolve([]), getCampaignNavigation(campaignId, viewMode)]);
  return (
    <CampaignShell active="search" availableCategories={navigation} campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} currentPath={q.trim() ? `/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}` : `/campaigns/${campaignId}/search`}>
      <main className="px-4 py-5 sm:px-6 sm:py-7">
        <h1 className="font-serif text-2xl font-semibold">Search campaign</h1>
        {q.trim() ? <p className="mt-3 text-sm text-[var(--muted)]">{results.length} result{results.length === 1 ? "" : "s"} for “{q}”</p> : <p className="mt-3 text-sm text-[var(--muted)]">Use campaign search in the navigation.</p>}
        <ul className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {results.map((entity) => (
            <li key={entity.id} className="py-4">
              <Link className="font-semibold hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)}>{entity.name}</Link>
              <span className="ml-2 text-sm text-[var(--muted)]">{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span>
              {hasEntityRole(entity, "enemy") ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Enemy</span> : null}
              {entity.aliases.length ? <p className="mt-1 text-sm text-[var(--muted)]">Also known as {entity.aliases.join(", ")}</p> : null}
            </li>
          ))}
        </ul>
      </main>
    </CampaignShell>
  );
}
