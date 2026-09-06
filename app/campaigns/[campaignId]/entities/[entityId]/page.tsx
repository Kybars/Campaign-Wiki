import Link from "next/link";
import { notFound } from "next/navigation";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, getEntityDetail } from "@/lib/db/queries";
import { ENTITY_TYPE_SINGULAR_LABELS, hasEntityRole } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ campaignId: string; entityId: string }> }) {
  const { campaignId, entityId } = await params;
  let campaign;
  let detail;
  try {
    [campaign, detail] = await Promise.all([getCampaign(campaignId), getEntityDetail(campaignId, entityId)]);
  } catch { notFound(); }
  const { entity, relationships, sources } = detail;
  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} />
      <main className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <Link className="text-sm text-[var(--accent)]" href={`/campaigns/${campaignId}`}>← Campaign home</Link>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</p>
          {hasEntityRole(entity, "enemy") ? <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-800">Enemy</span> : null}
        </div>
        <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tight">{entity.name}</h1>
        {entity.aliases.length ? <p className="mt-3 text-sm text-[var(--muted)]">Also known as {entity.aliases.join(", ")}</p> : null}
        <p className="mt-8 text-lg leading-8">{entity.summary}</p>

        <section className="mt-14">
          <h2 className="border-b border-[var(--line)] pb-3 font-serif text-2xl font-semibold">Relationships</h2>
          {relationships.length === 0 ? <p className="mt-5 text-[var(--muted)]">No supported relationships were found.</p> : (
            <div className="mt-2 divide-y divide-[var(--line)]">
              {relationships.map((relationship) => relationship.relatedEntity ? (
                <article key={relationship.id} className="py-5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm text-[var(--muted)]">{relationship.displayLabel}</span>
                    <Link className="text-lg font-semibold text-[var(--accent)] hover:underline" href={`/campaigns/${campaignId}/entities/${relationship.relatedEntity.id}`}>{relationship.relatedEntity.name} →</Link>
                  </div>
                  <p className="mt-2 leading-7">{relationship.description}</p>
                  {relationship.sources.length ? (
                    <details className="mt-3 text-sm text-[var(--muted)]">
                      <summary className="cursor-pointer">{relationship.sources.length} relationship source{relationship.sources.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-2 space-y-2 border-l border-[var(--line)] pl-4">
                        {relationship.sources.map((source) => <li key={source.id}><strong>{source.filename}, page {source.page_number}:</strong> “{source.supporting_text}”</li>)}
                      </ul>
                    </details>
                  ) : null}
                </article>
              ) : null)}
            </div>
          )}
        </section>

        <section className="mt-14">
          <h2 className="border-b border-[var(--line)] pb-3 font-serif text-2xl font-semibold">Sources</h2>
          <div className="mt-3 space-y-3">
            {sources.map((source) => (
              <details key={source.id} className="rounded-lg border border-[var(--line)] bg-white/60 p-4">
                <summary className="cursor-pointer font-semibold">{source.filename} — page {source.page_number}</summary>
                <blockquote className="mt-3 border-l-2 border-[var(--accent)] pl-4 leading-7 text-[var(--muted)]">“{source.supporting_text}”</blockquote>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
