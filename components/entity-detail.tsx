import Link from "next/link";
import { ENTITY_ROLE_LABELS, ENTITY_TYPE_SINGULAR_LABELS, hasEntityRole } from "@/lib/entities";
import type { EntityRole, EntityType } from "@/lib/db/types";
import { groupSourceEvidence, sourceReference, type SourceEvidence } from "@/lib/wiki/source-presentation";

interface RelatedEntity {
  id: string;
  name: string;
  type: EntityType;
}

interface Relationship {
  id: string;
  description: string;
  displayLabel: string;
  relatedEntity?: RelatedEntity;
  sources: SourceEvidence[];
}

interface LocationHierarchy {
  parent?: { id: string; name: string };
  children: Array<{ id: string; name: string }>;
  path: Array<{ id: string; name: string }>;
  isRoot: boolean;
  isOrphan: boolean;
}

export interface EntityDetailView {
  entity: {
    id: string;
    name: string;
    type: EntityType;
    aliases: string[];
    roles: EntityRole[];
    summary: string;
  };
  relationships: Relationship[];
  sources: SourceEvidence[];
  locationHierarchy?: LocationHierarchy;
}

function EntityLink({ campaignId, entity, className = "" }: { campaignId: string; entity: { id: string; name: string }; className?: string }) {
  return <Link className={`font-semibold text-[var(--accent)] underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`} href={`/campaigns/${campaignId}/entities/${entity.id}`}>{entity.name}</Link>;
}

function RelationshipText({ campaignId, relationship }: { campaignId: string; relationship: Relationship }) {
  const related = relationship.relatedEntity;
  if (!related) return null;
  const description = relationship.description.trim();
  if (!description) {
    return <><span className="capitalize">{relationship.displayLabel}</span> <EntityLink campaignId={campaignId} entity={related} />.</>;
  }
  const targetIndex = description.toLocaleLowerCase("en-US").indexOf(related.name.toLocaleLowerCase("en-US"));
  if (targetIndex < 0) {
    return <>{description} <span className="whitespace-nowrap">(<span className="capitalize">{relationship.displayLabel}</span> <EntityLink campaignId={campaignId} entity={related} />)</span></>;
  }
  const before = description.slice(0, targetIndex);
  const after = description.slice(targetIndex + related.name.length);
  return <>{before}<EntityLink campaignId={campaignId} entity={related} />{after}</>;
}

function SourceReference({ sources, label }: { sources: SourceEvidence[]; label: string }) {
  if (!sources.length) return null;
  const groups = groupSourceEvidence(sources);
  return (
    <details className="inline-block align-baseline text-xs text-[var(--muted)]">
      <summary aria-label={`Show evidence for ${label}: ${sourceReference(sources)}`} className="inline cursor-pointer rounded px-1 font-semibold text-[var(--accent)] underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">{sourceReference(sources)}</summary>
      <div className="mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-[var(--line)] bg-white p-3 text-left shadow-sm">
        {groups.map((document) => (
          <div className="mb-3 last:mb-0" key={document.documentId}>
            <p className="font-semibold text-[var(--ink)]">{document.filename}</p>
            {document.pages.map((page) => (
              <div className="mt-2" key={page.pageNumber}>
                <p className="font-semibold">Page {page.pageNumber}</p>
                {page.sources.map((source) => <blockquote className="mt-1 border-l-2 border-[var(--accent)] pl-2 leading-5" key={source.id}>“{source.supporting_text}”</blockquote>)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function EntitySources({ sources }: { sources: SourceEvidence[] }) {
  const groups = groupSourceEvidence(sources);
  return (
    <section aria-labelledby="sources-heading">
      <h2 className="font-serif text-xl font-semibold" id="sources-heading">Sources</h2>
      {groups.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">No entity source excerpts were recorded.</p> : (
        <div className="mt-3 space-y-3">
          {groups.map((document) => (
            <details className="rounded-lg border border-[var(--line)] bg-white/50 px-3 py-2" key={document.documentId}>
              <summary className="cursor-pointer font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                {document.filename}
                <span className="ml-2 text-sm font-normal text-[var(--muted)]">Pages {document.pages.map((page) => page.pageNumber).join(" · ")}</span>
              </summary>
              <div className="mt-3 space-y-3 text-sm text-[var(--muted)]">
                {document.pages.map((page) => (
                  <details className="border-l border-[var(--line)] pl-3" key={page.pageNumber}>
                    <summary className="cursor-pointer font-semibold text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Page {page.pageNumber}</summary>
                    {page.sources.map((source) => <blockquote className="mt-2 leading-6" key={source.id}>“{source.supporting_text}”</blockquote>)}
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function LocationContext({ campaignId, hierarchy }: { campaignId: string; hierarchy: LocationHierarchy }) {
  return (
    <section className="mt-7 border-l-2 border-[var(--line)] pl-4" aria-labelledby="location-context-heading">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--muted)]" id="location-context-heading">Location context</h2>
      {hierarchy.path.length > 1 ? (
        <nav aria-label="Location path" className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-[var(--muted)]">
          {hierarchy.path.map((location, index) => index === hierarchy.path.length - 1
            ? <span className="font-semibold text-[var(--ink)]" key={location.id}>{location.name}</span>
            : <span className="flex items-center gap-x-1" key={location.id}><EntityLink campaignId={campaignId} entity={location} /><span aria-hidden="true">›</span></span>)}
        </nav>
      ) : null}
      {hierarchy.parent ? <p className="mt-2 text-sm text-[var(--muted)]">Located in <EntityLink campaignId={campaignId} entity={hierarchy.parent} />.</p> : null}
      {hierarchy.children.length ? <div className="mt-3 text-sm text-[var(--muted)]"><h3 className="font-semibold text-[var(--ink)]">Sublocations</h3><p className="mt-1">{hierarchy.children.map((child, index) => <span key={child.id}>{index ? " · " : ""}<EntityLink campaignId={campaignId} entity={child} /></span>)}</p></div> : null}
    </section>
  );
}

export function EntityDetail({ campaignId, detail }: { campaignId: string; detail: EntityDetailView }) {
  const { entity, relationships, sources, locationHierarchy } = detail;
  const relatedEntities = [...new Map(relationships.flatMap((relationship) => relationship.relatedEntity ? [[relationship.relatedEntity.id, relationship.relatedEntity] as const] : [])).values()];

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14">
      <article className="min-w-0">
        <header>
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
            <span>{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span>
            {hasEntityRole(entity, "enemy") ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.65rem] tracking-wide text-red-800">{ENTITY_ROLE_LABELS.enemy}</span> : null}
          </div>
          <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{entity.name}</h1>
          {entity.aliases.length ? <p className="mt-2 text-sm text-[var(--muted)]">Also known as {entity.aliases.join(" · ")}</p> : null}
          {entity.summary ? <p className="mt-5 max-w-3xl text-lg leading-8">{entity.summary}</p> : null}
        </header>

        {locationHierarchy ? <LocationContext campaignId={campaignId} hierarchy={locationHierarchy} /> : null}

        <section className="mt-10" aria-labelledby="connections-heading">
          <h2 className="border-b border-[var(--line)] pb-3 font-serif text-2xl font-semibold" id="connections-heading">Connections</h2>
          {relationships.length === 0 ? <p className="mt-4 text-[var(--muted)]">No supported relationships were found.</p> : (
            <ul className="divide-y divide-[var(--line)]">
              {relationships.map((relationship) => relationship.relatedEntity ? (
                <li className="py-3 leading-7" key={relationship.id}>
                  <RelationshipText campaignId={campaignId} relationship={relationship} /> <SourceReference label={relationship.displayLabel} sources={relationship.sources} />
                </li>
              ) : null)}
            </ul>
          )}
        </section>
      </article>

      <aside className="space-y-8 border-t border-[var(--line)] pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        {relatedEntities.length ? (
          <section aria-labelledby="related-heading">
            <h2 className="font-serif text-xl font-semibold" id="related-heading">Related</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {relatedEntities.map((related) => <li key={related.id}><EntityLink campaignId={campaignId} entity={related} /> <span className="text-[var(--muted)]">· {ENTITY_TYPE_SINGULAR_LABELS[related.type]}</span></li>)}
            </ul>
          </section>
        ) : null}
        <EntitySources sources={sources} />
      </aside>
    </div>
  );
}
