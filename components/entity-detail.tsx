"use client";

import Link from "next/link";
import { useState } from "react";
import { ENTITY_ROLE_LABELS, ENTITY_TYPE_SINGULAR_LABELS, hasEntityRole } from "@/lib/entities";
import type { EntityRole, EntityType } from "@/lib/db/types";
import { groupSourceEvidence, type SourceEvidence } from "@/lib/wiki/source-presentation";
import { articleQuickFacts, articleSections, factLabel } from "@/lib/wiki/article";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";
import { EntityPreviewLink, type EntityPreview } from "@/components/entity-preview-link";
import { EntityCurationControls } from "@/components/curation-controls";
import { ConnectedEntityConnectionCard } from "@/components/connected-entity-curation-popover";
import { EvidencePopover } from "@/components/evidence-popover";
import type { EntityProminence, KnowledgeVisibility, QuestStatus } from "@/lib/knowledge/types";

type RelatedEntity = EntityPreview & { visibility?: KnowledgeVisibility; prominence?: EntityProminence | null };
interface Relationship { id: string; relationshipIds?: string[]; description: string; displayLabel: string; relationship_type?: string; visibility?: KnowledgeVisibility; relatedEntity?: RelatedEntity; sources: SourceEvidence[]; }
interface LocationHierarchy { parent?: { id: string; name: string }; children: Array<{ id: string; name: string }>; path: Array<{ id: string; name: string }>; isRoot: boolean; isOrphan: boolean; }
interface ArticleFact { id: string; fieldKey: string; content: string; sortOrder: number; evidence: SourceEvidence[]; }

export interface EntityDetailView {
  entity: { id: string; name: string; type: EntityType; aliases: string[]; roles: EntityRole[]; summary: string; prominence?: EntityProminence | null; visibility?: KnowledgeVisibility; quest_status?: QuestStatus | null };
  facts?: ArticleFact[];
  relationships: Relationship[];
  sources: SourceEvidence[];
  locationHierarchy?: LocationHierarchy;
}

function EntityLink({ campaignId, entity, viewMode }: { campaignId: string; entity: { id: string; name: string }; viewMode: CampaignViewMode }) {
  return <Link className="font-semibold text-[var(--accent)] underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)}>{entity.name}</Link>;
}

function Citation({ sources, label, anchors }: { sources: SourceEvidence[]; label: string; anchors?: string[] }) {
  return <EvidencePopover anchors={anchors} label={label} sources={sources} />;
}

function FactList({ facts }: { facts: ArticleFact[] }) {
  return <ul className="space-y-3 text-[var(--muted)]">{facts.map((fact) => <li key={fact.id} className="leading-7"><span className="font-semibold text-[var(--ink)]">{factLabel(fact.fieldKey)}.</span> {fact.content} <Citation label={factLabel(fact.fieldKey)} sources={fact.evidence} /></li>)}</ul>;
}

function LocationContext({ campaignId, hierarchy, viewMode }: { campaignId: string; hierarchy: LocationHierarchy; viewMode: CampaignViewMode }) {
  return <section className="mt-7 border-l-2 border-[var(--line)] pl-4" aria-labelledby="location-context-heading"><h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--muted)]" id="location-context-heading">Location context</h2>{hierarchy.path.length > 1 ? <nav aria-label="Location path" className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-[var(--muted)]">{hierarchy.path.map((location, index) => index === hierarchy.path.length - 1 ? <span className="font-semibold text-[var(--ink)]" key={location.id}>{location.name}</span> : <span className="flex items-center gap-x-1" key={location.id}><EntityLink campaignId={campaignId} entity={location} viewMode={viewMode} /><span aria-hidden="true">›</span></span>)}</nav> : null}{hierarchy.parent ? <p className="mt-2 text-sm text-[var(--muted)]">Located in <EntityLink campaignId={campaignId} entity={hierarchy.parent} viewMode={viewMode} />.</p> : null}{hierarchy.children.length ? <div className="mt-3 text-sm text-[var(--muted)]"><h3 className="font-semibold text-[var(--ink)]">Sublocations</h3><p className="mt-1">{hierarchy.children.map((child, index) => <span key={child.id}>{index ? " · " : ""}<EntityLink campaignId={campaignId} entity={child} viewMode={viewMode} /></span>)}</p></div> : null}</section>;
}

function sentenceCase(value: string) { return value ? value[0].toLocaleUpperCase("en-US") + value.slice(1) : value; }

function Connections({ campaignId, entity, relationships, viewMode, hideContainment }: { campaignId: string; entity: EntityDetailView["entity"]; relationships: Relationship[]; viewMode: CampaignViewMode; hideContainment: boolean }) {
  const remaining = relationships.filter((relationship) => relationship.relatedEntity && !(hideContainment && relationship.relationship_type === "located in"));
  const grouped = new Map<string, Relationship[]>();
  for (const relationship of remaining) { const id = relationship.relatedEntity!.id; grouped.set(id, [...(grouped.get(id) ?? []), relationship]); }
  return <section className="mt-10" aria-labelledby="connections-heading"><h2 className="border-b border-[var(--line)] pb-3 font-serif text-2xl font-semibold" id="connections-heading">Connections</h2>{!remaining.length ? <p className="mt-4 text-[var(--muted)]">No supported relationships were found.</p> : <ul className="space-y-5 pt-4">{[...grouped.values()].map((group) => { const related = group[0].relatedEntity!; const relationshipRows = <ul className="mt-2 space-y-2">{group.map((relationship) => <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" key={relationship.id}><span className="min-w-0 flex-1 text-[var(--muted)]"><span className="font-semibold text-[var(--ink)]">{sentenceCase(relationship.displayLabel)}</span>{relationship.description.trim() ? <span> — {relationship.description.trim()}</span> : null} <Citation anchors={[entity.name, related.name]} label={relationship.displayLabel} sources={relationship.sources} /></span></li>)}</ul>; return viewMode === "dm" ? <ConnectedEntityConnectionCard campaignId={campaignId} currentEntity={entity} initialRelatedEntity={related} key={related.id} relationships={group} /> : <li className="rounded-lg border border-[var(--line)] bg-white/45 p-4" key={related.id}><h3 className="font-serif text-xl font-semibold"><EntityPreviewLink campaignId={campaignId} entity={related} viewMode={viewMode} /></h3>{relationshipRows}</li>; })}</ul>}</section>;
}

function RelatedList({ campaignId, viewMode, title, relationships }: { campaignId: string; viewMode: CampaignViewMode; title: string; relationships: Relationship[] }) {
  const related = relationships.filter((relationship) => relationship.relatedEntity);
  if (!related.length) return null;
  return <section className="mt-7" aria-labelledby={`related-${title}`}><h2 className="border-b border-[var(--line)] pb-2 font-serif text-xl font-semibold" id={`related-${title}`}>{title}</h2><p className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[var(--muted)]">{related.map((relationship, index) => <span key={relationship.id}>{index ? <span aria-hidden="true">· </span> : null}<EntityPreviewLink campaignId={campaignId} entity={relationship.relatedEntity!} viewMode={viewMode} /></span>)}</p></section>;
}

function QuestReference({ campaignId, relationships, viewMode }: { campaignId: string; relationships: Relationship[]; viewMode: CampaignViewMode }) {
  const questgiver = relationships.filter((relationship) => relationship.relationship_type === "questgiver_for");
  const locations = relationships.filter((relationship) => relationship.relationship_type === "concerns" && relationship.relatedEntity?.type === "location");
  const items = relationships.filter((relationship) => relationship.relationship_type === "requires" && relationship.relatedEntity?.type === "item");
  const factions = relationships.filter((relationship) => relationship.relatedEntity?.type === "faction");
  return <><RelatedList campaignId={campaignId} viewMode={viewMode} title="Questgiver" relationships={questgiver} /><RelatedList campaignId={campaignId} viewMode={viewMode} title="Important locations" relationships={locations} /><RelatedList campaignId={campaignId} viewMode={viewMode} title="Important items" relationships={items} /><RelatedList campaignId={campaignId} viewMode={viewMode} title="Involved factions" relationships={factions} /></>;
}

function EventReference({ campaignId, relationships, viewMode }: { campaignId: string; relationships: Relationship[]; viewMode: CampaignViewMode }) {
  const locations = relationships.filter((relationship) => relationship.relationship_type === "occurred_at");
  const participants = relationships.filter((relationship) => relationship.relationship_type === "involved");
  return <><RelatedList campaignId={campaignId} viewMode={viewMode} title="Location" relationships={locations} /><RelatedList campaignId={campaignId} viewMode={viewMode} title="Participants" relationships={participants} /></>;
}

function Sources({ sources }: { sources: SourceEvidence[] }) {
  const groups = groupSourceEvidence(sources);
  if (!groups.length) return null;
  return <section aria-labelledby="sources-heading"><h2 className="font-serif text-xl font-semibold" id="sources-heading">Sources</h2><div className="mt-3 space-y-3">{groups.map((document) => <details className="rounded-lg border border-[var(--line)] bg-white/50 px-3 py-2" key={document.documentId}><summary className="cursor-pointer font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">{document.filename}<span className="ml-2 text-sm font-normal text-[var(--muted)]">Pages {document.pages.map((page) => page.pageNumber).join(" · ")}</span></summary><div className="mt-3 space-y-3 text-sm text-[var(--muted)]">{document.pages.map((page) => <div className="border-l border-[var(--line)] pl-3" key={page.pageNumber}><p className="font-semibold text-[var(--ink)]">Page {page.pageNumber}</p>{page.sources.map((source) => <blockquote className="mt-2 break-words leading-6" key={source.id}>“{source.supporting_text}”</blockquote>)}</div>)}</div></details>)}</div></section>;
}

export function EntityDetail({ campaignId, detail, viewMode = "dm" }: { campaignId: string; detail: EntityDetailView; viewMode?: CampaignViewMode }) {
  const { entity, facts = [], relationships, sources, locationHierarchy } = detail;
  const [currentVisibility, setCurrentVisibility] = useState(entity.visibility ?? "dm_only");
  const currentEntity = { ...entity, visibility: currentVisibility };
  const quickFacts = articleQuickFacts(entity.type, facts); const sections = articleSections(entity.type, facts); const factSources = facts.flatMap((fact) => fact.evidence);
  return <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14"><article className="min-w-0"><header><div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[var(--accent)]"><span>{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span>{hasEntityRole(entity, "enemy") ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.65rem] tracking-wide text-red-800">{ENTITY_ROLE_LABELS.enemy}</span> : null}</div><h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{entity.name}</h1>{entity.aliases.length ? <p className="mt-2 text-sm text-[var(--muted)]"><span className="font-semibold text-[var(--ink)]">Aliases:</span> {entity.aliases.join(" · ")}</p> : null}{viewMode === "dm" ? <EntityCurationControls campaignId={campaignId} entity={{ id: entity.id, name: entity.name, type: entity.type, prominence: entity.prominence ?? null, visibility: currentVisibility, quest_status: entity.quest_status ?? null }} onVisibilityChange={setCurrentVisibility} /> : null}{entity.summary ? <p className="mt-5 max-w-3xl text-lg leading-8">{entity.summary}</p> : null}</header>{quickFacts.length ? <section className="mt-7 rounded-lg border border-[var(--line)] bg-white/50 px-4 py-3" aria-labelledby="glance-heading"><h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--muted)]" id="glance-heading">At a glance</h2><FactList facts={quickFacts} /></section> : null}{entity.type === "quest" ? <QuestReference campaignId={campaignId} relationships={relationships} viewMode={viewMode} /> : null}{entity.type === "event" ? <EventReference campaignId={campaignId} relationships={relationships} viewMode={viewMode} /> : null}{locationHierarchy ? <LocationContext campaignId={campaignId} hierarchy={locationHierarchy} viewMode={viewMode} /> : null}{sections.map((section) => <section className="mt-10" aria-labelledby={`section-${section.title}`} key={section.title}><h2 className="border-b border-[var(--line)] pb-3 font-serif text-2xl font-semibold" id={`section-${section.title}`}>{section.title}</h2><div className="mt-4"><FactList facts={section.facts} /></div></section>)}<Connections campaignId={campaignId} entity={currentEntity} relationships={relationships} viewMode={viewMode} hideContainment={entity.type === "location"} /></article><aside className="space-y-8 border-t border-[var(--line)] pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><Sources sources={[...sources, ...factSources]} /></aside></div>;
}
