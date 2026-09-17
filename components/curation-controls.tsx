"use client";

import { useState } from "react";
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_SINGULAR_LABELS, ENTITY_TYPES } from "@/lib/entities";
import type { EntityType } from "@/lib/db/types";
import type { EntityProminence, KnowledgeVisibility, QuestStatus } from "@/lib/knowledge/types";

async function save(campaignId: string, body: object) {
  const response = await fetch(`/api/campaigns/${campaignId}/curation`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Could not save this change");
}

export function EntityVisibilityToggle({ campaignId, entityId, initialVisibility, label, onVisibilityChange }: { campaignId: string; entityId: string; initialVisibility: KnowledgeVisibility; label: string; onVisibilityChange?: (visibility: KnowledgeVisibility) => void }) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    const previous = visibility; const next = previous === "player_visible" ? "dm_only" : "player_visible";
    setVisibility(next); setBusy(true); setError("");
    try { await save(campaignId, { kind: "entity", entityId, patch: { field: "visibility", value: next } }); onVisibilityChange?.(next); }
    catch (caught) { setVisibility(previous); setError(caught instanceof Error ? caught.message : "Could not save"); }
    finally { setBusy(false); }
  };
  return <span className="inline-flex items-center gap-2"><button aria-label={`${label}: ${visibility === "player_visible" ? "visible" : "hidden"} in Player View`} aria-checked={visibility === "player_visible"} className={`relative h-5 w-9 rounded-full border transition ${visibility === "player_visible" ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--line)] bg-stone-200"}`} disabled={busy} onClick={toggle} role="switch" type="button"><span className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition ${visibility === "player_visible" ? "left-[1.1rem]" : "left-0.5"}`} /></button>{error ? <span className="text-xs text-red-700" role="alert">{error}</span> : null}</span>;
}

export function RelationshipVisibilityToggle({ campaignId, relationshipIds, initialVisibility, blockers }: { campaignId: string; relationshipIds: string[]; initialVisibility: KnowledgeVisibility; blockers: string[] }) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const disabled = blockers.length > 0;
  const reason = blockers.join(" ");
  const toggle = async () => {
    if (disabled) return;
    const previous = visibility; const next = previous === "player_visible" ? "dm_only" : "player_visible";
    setVisibility(next); setBusy(true); setError("");
    try { await save(campaignId, { kind: "relationship", relationshipIds, visibility: next }); }
    catch (caught) { setVisibility(previous); setError(caught instanceof Error ? caught.message : "Could not save"); }
    finally { setBusy(false); }
  };
  return <span className="group relative inline-flex items-center"><button aria-describedby={disabled ? `relationship-blocked-${relationshipIds[0]}` : undefined} aria-disabled={disabled} aria-label={`Relationship ${visibility === "player_visible" ? "visible" : "hidden"} in Player View`} aria-checked={visibility === "player_visible"} className={`relative h-5 w-9 rounded-full border transition ${visibility === "player_visible" ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--line)] bg-stone-200"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`} disabled={busy} onClick={toggle} role="switch" type="button"><span className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition ${visibility === "player_visible" ? "left-[1.1rem]" : "left-0.5"}`} /></button>{disabled ? <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-64 rounded border border-[var(--line)] bg-white p-2 text-xs leading-5 text-[var(--ink)] shadow-lg group-hover:block group-focus-within:block" id={`relationship-blocked-${relationshipIds[0]}`} role="tooltip">{reason}</span> : null}{error ? <span className="ml-2 text-xs text-red-700" role="alert">{error}</span> : null}</span>;
}

export function EntityCurationControls({ campaignId, entity }: { campaignId: string; entity: { id: string; name: string; type: EntityType; prominence: EntityProminence | null; visibility: KnowledgeVisibility; quest_status: QuestStatus | null } }) {
  const [type, setType] = useState(entity.type);
  const [pendingType, setPendingType] = useState<EntityType | null>(null);
  const [prominence, setProminence] = useState<EntityProminence | null>(entity.prominence);
  const [status, setStatus] = useState<QuestStatus | null>(entity.quest_status);
  const [error, setError] = useState("");
  const patch = async (field: "prominence" | "quest_status", value: EntityProminence | QuestStatus | null) => {
    const previous = field === "prominence" ? prominence : status;
    if (field === "prominence") setProminence(value as EntityProminence | null); else setStatus(value as QuestStatus | null);
    setError("");
    try { await save(campaignId, { kind: "entity", entityId: entity.id, patch: { field, value } }); }
    catch (caught) { if (field === "prominence") setProminence(previous as EntityProminence | null); else setStatus(previous as QuestStatus | null); setError(caught instanceof Error ? caught.message : "Could not save"); }
  };
  const confirmType = async () => {
    if (!pendingType) return;
    setError("");
    try { await save(campaignId, { kind: "entity", entityId: entity.id, patch: { field: "type", value: pendingType } }); setType(pendingType); setPendingType(null); window.location.reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save"); }
  };
  return <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] bg-white/45 p-3 text-sm">
    <label className="grid gap-1 font-semibold">Type<select className="rounded border border-[var(--line)] bg-white px-2 py-1.5 font-normal" onChange={(event) => setPendingType(event.target.value as EntityType)} value={type}>{ENTITY_TYPES.map((value) => <option key={value} value={value}>{ENTITY_TYPE_SINGULAR_LABELS[value]}</option>)}</select></label>
    <label className="grid gap-1 font-semibold">Prominence<select className="rounded border border-[var(--line)] bg-white px-2 py-1.5 font-normal" onChange={(event) => void patch("prominence", event.target.value as EntityProminence)} value={prominence ?? "minor"}><option value="major">Major</option><option value="supporting">Supporting</option><option value="minor">Minor</option></select></label>
    {type === "quest" ? <label className="grid gap-1 font-semibold">Status<select className="rounded border border-[var(--line)] bg-white px-2 py-1.5 font-normal" onChange={(event) => void patch("quest_status", event.target.value as QuestStatus)} value={status ?? "not_started"}><option value="ongoing">Ongoing</option><option value="not_started">Not started</option><option value="finished">Finished</option></select></label> : null}
    <span className="grid gap-1 font-semibold">Player visible<span className="h-8 pt-1"><EntityVisibilityToggle campaignId={campaignId} entityId={entity.id} initialVisibility={entity.visibility} label={entity.name} /></span></span>
    {error ? <p className="w-full text-xs text-red-700" role="alert">{error}</p> : null}
    {pendingType ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"><dialog aria-labelledby="type-change-title" aria-modal="true" className="relative m-0 max-w-md rounded-xl border border-[var(--line)] bg-[var(--paper)] p-6 text-[var(--ink)] shadow-2xl" onKeyDown={(event) => { if (event.key === "Escape") setPendingType(null); }} open><h2 className="font-serif text-2xl font-semibold" id="type-change-title">Change entity type?</h2><p className="mt-3 leading-7">{entity.name} will move from {ENTITY_TYPE_LABELS[type]} to {ENTITY_TYPE_LABELS[pendingType]}. Existing relationships, aliases, sources, and visibility will be kept.</p>{type === "location" || pendingType === "location" ? <p className="mt-2 text-sm leading-6 text-[var(--muted)]">No hierarchy relationship will be invented or deleted because of this type change.</p> : null}<div className="mt-6 flex justify-end gap-3"><button autoFocus className="rounded border border-[var(--line)] px-3 py-2 font-semibold" onClick={() => setPendingType(null)} type="button">Cancel</button><button className="button-primary" onClick={() => void confirmType()} type="button">Change to {ENTITY_TYPE_SINGULAR_LABELS[pendingType]}</button></div></dialog></div> : null}
  </div>;
}
