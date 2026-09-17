"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EntityVisibilityToggle, RelationshipVisibilityToggle } from "@/components/curation-controls";
import { ENTITY_TYPE_SINGULAR_LABELS, prominenceGroup, prominenceGroupLabel } from "@/lib/entities";
import { campaignHref } from "@/lib/campaign-view";
import { relationshipVisibilityBlockers } from "@/lib/curation";
import type { EntityType } from "@/lib/db/types";
import type { EntityProminence, KnowledgeVisibility } from "@/lib/knowledge/types";
import { EvidencePopover } from "@/components/evidence-popover";
import type { SourceEvidence } from "@/lib/wiki/source-presentation";

type CuratedEntity = { id: string; name: string; type: EntityType; summary?: string; visibility?: KnowledgeVisibility; prominence?: EntityProminence | null };
type ConnectedRelationship = { id: string; relationshipIds?: string[]; description: string; displayLabel: string; visibility?: KnowledgeVisibility; sources: SourceEvidence[] };
type CurrentEntity = { id: string; name: string; visibility?: KnowledgeVisibility };

export function connectionVisibilityBlockers(currentEntity: CurrentEntity, relatedEntity: CuratedEntity) {
  return relationshipVisibilityBlockers(
    { name: currentEntity.name, visibility: currentEntity.visibility ?? "dm_only" },
    { name: relatedEntity.name, visibility: relatedEntity.visibility ?? "dm_only" },
  );
}

export function updateConnectedEntity(entity: CuratedEntity, field: "visibility" | "prominence", value: KnowledgeVisibility | EntityProminence): CuratedEntity {
  return { ...entity, [field]: value };
}

function sentenceCase(value: string) {
  return value ? value[0].toLocaleUpperCase("en-US") + value.slice(1) : value;
}

function ConnectedEntityCurationPopover({ campaignId, relatedEntity, onVisibilityChange, children }: { campaignId: string; relatedEntity: CuratedEntity; onVisibilityChange: (visibility: KnowledgeVisibility) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutsidePointer); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  const visibility = relatedEntity.visibility ?? "dm_only";
  return <div className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onFocus={() => setOpen(true)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} ref={rootRef}>
    <div className="flex items-center gap-2"><h3 className="min-w-0"><Link className="font-serif text-xl font-semibold text-[var(--accent)] underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${relatedEntity.id}`, "dm")}>{relatedEntity.name}</Link></h3></div>
    <div aria-hidden={!open} aria-label={`Curation for ${relatedEntity.name}`} className={open ? "absolute left-0 z-30 mt-0.5" : "hidden"} role="dialog"><div className="w-72 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-3 text-sm text-[var(--ink)] shadow-lg"><div className="flex items-center justify-between gap-3"><p className="font-serif text-lg font-semibold">{relatedEntity.name}</p><EntityVisibilityToggle campaignId={campaignId} entityId={relatedEntity.id} initialVisibility={visibility} label={relatedEntity.name} onVisibilityChange={onVisibilityChange} /></div><p className="mt-0.5 text-xs text-[var(--muted)]">{ENTITY_TYPE_SINGULAR_LABELS[relatedEntity.type]} · {prominenceGroupLabel(prominenceGroup(relatedEntity.prominence))}</p>{relatedEntity.summary ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{relatedEntity.summary}</p> : null}</div></div>
    {children}
  </div>;
}

export function ConnectedEntityConnectionCard({ campaignId, currentEntity, initialRelatedEntity, relationships }: { campaignId: string; currentEntity: CurrentEntity; initialRelatedEntity: CuratedEntity; relationships: ConnectedRelationship[] }) {
  const [relatedEntity, setRelatedEntity] = useState(initialRelatedEntity);
  const blockers = connectionVisibilityBlockers(currentEntity, relatedEntity);
  return <li className="rounded-lg border border-[var(--line)] bg-white/45 p-4"><ConnectedEntityCurationPopover campaignId={campaignId} relatedEntity={relatedEntity} onVisibilityChange={(visibility) => setRelatedEntity((entity) => updateConnectedEntity(entity, "visibility", visibility))}><ul className="mt-2 space-y-2">{relationships.map((relationship) => <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" key={relationship.id}><span className="min-w-0 flex-1 text-[var(--muted)]"><span className="font-semibold text-[var(--ink)]">{sentenceCase(relationship.displayLabel)}</span>{relationship.description.trim() ? <span> — {relationship.description.trim()}</span> : null} <EvidencePopover anchors={[currentEntity.name, relatedEntity.name]} label={relationship.displayLabel} sources={relationship.sources} /></span><RelationshipVisibilityToggle blockers={blockers} campaignId={campaignId} initialVisibility={relationship.visibility ?? "dm_only"} relationshipIds={relationship.relationshipIds ?? [relationship.id]} /></li>)}</ul></ConnectedEntityCurationPopover></li>;
}
