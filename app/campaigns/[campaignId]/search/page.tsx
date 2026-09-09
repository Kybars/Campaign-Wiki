import Link from "next/link";
import { notFound } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, searchCampaignEntities } from "@/lib/db/queries";
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
  const results = q.trim() ? await searchCampaignEntities(campaignId, q, viewMode) : [];
  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} currentPath={q.trim() ? `/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}` : `/campaigns/${campaignId}/search`} active="search" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-serif text-4xl font-semibold">Search campaign</h1>
        <form className="mt-6 flex gap-2">
          {viewMode === "player" ? <input type="hidden" name="view" value="player" /> : null}
          <input autoFocus name="q" defaultValue={q} placeholder="Entity name or alias" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]" />
          <button className="rounded-lg bg-[var(--ink)] px-5 py-3 font-semibold text-white">Search</button>
        </form>
        {q.trim() ? <p className="mt-6 text-sm text-[var(--muted)]">{results.length} result{results.length === 1 ? "" : "s"} for “{q}”</p> : null}
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
    </>
  );
}
