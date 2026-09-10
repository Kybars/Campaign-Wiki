import { groupSourceEvidence, sourceReference, type SourceEvidence } from "@/lib/wiki/source-presentation";

export function CampaignOverview({ overview, evidence }: { overview: string | null; evidence: SourceEvidence[] }) {
  if (!overview) return null;
  const grouped = groupSourceEvidence(evidence);
  return <section className="mt-7 max-w-3xl border-l-2 border-[var(--accent)] pl-4" aria-labelledby="campaign-overview-heading">
    <h2 className="font-serif text-2xl font-semibold" id="campaign-overview-heading">Campaign overview</h2>
    <p className="mt-2 leading-7 text-[var(--muted)]">{overview}</p>
    {grouped.length ? <details className="mt-2 inline-block text-xs text-[var(--muted)]"><summary className="cursor-pointer font-semibold text-[var(--accent)] underline decoration-dotted underline-offset-2">Evidence {sourceReference(evidence)}</summary><div className="mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-[var(--line)] bg-white p-3 shadow-lg">{grouped.map((document) => <div className="mb-3 last:mb-0" key={document.documentId}><p className="font-semibold text-[var(--ink)]">{document.filename}</p>{document.pages.map((page) => <blockquote className="mt-2 border-l-2 border-[var(--accent)] pl-2 leading-5" key={page.pageNumber}>p.{page.pageNumber}: “{page.sources.map((source) => source.supporting_text).join(" ")}”</blockquote>)}</div>)}</div></details> : null}
  </section>;
}
