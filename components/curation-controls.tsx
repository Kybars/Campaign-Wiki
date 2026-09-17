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

export async function persistOptimisticVisibilityChange({ previous, next, saveChange, onVisibilityChange }: { previous: KnowledgeVisibility; next: KnowledgeVisibility; saveChange: () => Promise<void>; onVisibilityChange: (visibility: KnowledgeVisibility) => void }) {
  onVisibilityChange(next);
  try { await saveChange(); }
  catch (caught) { onVisibilityChange(previous); throw caught; }
}

function VisibilityIcon({ visible }: { visible: boolean }) {
  return visible
    ? <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
    : <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3l18 18" /><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17.8 17.8 0 0 1-3.2 3.8M6.2 6.2A17.8 17.8 0 0 0 2.5 12s3.5 7 9.5 7c1.4 0 2.7-.3 3.8-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
}

function VisibilityToggle({ visibility, label, disabled = false, disabledReason, disabledId, busy = false, onToggle }: { visibility: KnowledgeVisibility; label: string; disabled?: boolean; disabledReason?: string; disabledId?: string; busy?: boolean; onToggle: () => void }) {
  const visible = visibility === "player_visible";
  const stateText = visible ? "Visible to players" : "Hidden from players";
  const actionLabel = visible ? `Hide ${label} from players` : `Show ${label} to players`;
  const tooltip = disabled ? disabledReason : stateText;
  const descriptionId = disabled && disabledReason ? `visibility-blocked-${(disabledId ?? label).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : undefined;
  return <span className="group relative inline-flex items-center">
    <button aria-checked={visible} aria-describedby={descriptionId} aria-disabled={disabled || undefined} aria-label={actionLabel} className={`grid size-7 place-items-center rounded-full border shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${visible ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line)] bg-white/70 text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`} disabled={busy} onClick={() => { if (!disabled) onToggle(); }} role="switch" title={tooltip} type="button"><VisibilityIcon visible={visible} /></button>
    {disabledReason ? <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-64 rounded border border-[var(--line)] bg-white p-2 text-xs leading-5 text-[var(--ink)] shadow-lg group-hover:block group-focus-within:block" id={descriptionId} role="tooltip">{disabledReason}</span> : null}
  </span>;
}

export function EntityVisibilityToggle({ campaignId, entityId, initialVisibility, visibility: controlledVisibility, label, onVisibilityChange }: { campaignId: string; entityId: string; initialVisibility?: KnowledgeVisibility; visibility?: KnowledgeVisibility; label: string; onVisibilityChange?: (visibility: KnowledgeVisibility) => void }) {
  const [uncontrolledVisibility, setUncontrolledVisibility] = useState(initialVisibility ?? controlledVisibility ?? "dm_only");
  const visibility = controlledVisibility ?? uncontrolledVisibility;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    const previous = visibility; const next = previous === "player_visible" ? "dm_only" : "player_visible";
    const publish = (value: KnowledgeVisibility) => { if (controlledVisibility === undefined) setUncontrolledVisibility(value); onVisibilityChange?.(value); };
    setBusy(true); setError("");
    try { await persistOptimisticVisibilityChange({ previous, next, onVisibilityChange: publish, saveChange: () => save(campaignId, { kind: "entity", entityId, patch: { field: "visibility", value: next } }) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save"); }
    finally { setBusy(false); }
  };
  return <span className="inline-flex items-center gap-2"><VisibilityToggle busy={busy} label={label} onToggle={() => void toggle()} visibility={visibility} />{error ? <span className="text-xs text-red-700" role="alert">{error}</span> : null}</span>;
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
  return <span className="inline-flex items-center"><VisibilityToggle busy={busy} disabled={disabled} disabledId={`relationship-${relationshipIds[0]}`} disabledReason={reason || undefined} label="relationship" onToggle={() => void toggle()} visibility={visibility} />{error ? <span className="ml-2 text-xs text-red-700" role="alert">{error}</span> : null}</span>;
}

export function EntityCurationControls({ campaignId, entity, onVisibilityChange }: { campaignId: string; entity: { id: string; name: string; type: EntityType; prominence: EntityProminence | null; visibility: KnowledgeVisibility; quest_status: QuestStatus | null }; onVisibilityChange: (visibility: KnowledgeVisibility) => void }) {
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
    <span className="grid gap-1 font-semibold"><span className="sr-only">Player visibility</span><span className="h-8 pt-0.5"><EntityVisibilityToggle campaignId={campaignId} entityId={entity.id} label={entity.name} onVisibilityChange={onVisibilityChange} visibility={entity.visibility} /></span></span>
    {error ? <p className="w-full text-xs text-red-700" role="alert">{error}</p> : null}
    {pendingType ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"><dialog aria-labelledby="type-change-title" aria-modal="true" className="relative m-0 max-w-md rounded-xl border border-[var(--line)] bg-[var(--paper)] p-6 text-[var(--ink)] shadow-2xl" onKeyDown={(event) => { if (event.key === "Escape") setPendingType(null); }} open><h2 className="font-serif text-2xl font-semibold" id="type-change-title">Change entity type?</h2><p className="mt-3 leading-7">{entity.name} will move from {ENTITY_TYPE_LABELS[type]} to {ENTITY_TYPE_LABELS[pendingType]}. Existing relationships, aliases, sources, and visibility will be kept.</p>{type === "location" || pendingType === "location" ? <p className="mt-2 text-sm leading-6 text-[var(--muted)]">No hierarchy relationship will be invented or deleted because of this type change.</p> : null}<div className="mt-6 flex justify-end gap-3"><button autoFocus className="rounded border border-[var(--line)] px-3 py-2 font-semibold" onClick={() => setPendingType(null)} type="button">Cancel</button><button className="button-primary" onClick={() => void confirmType()} type="button">Change to {ENTITY_TYPE_SINGULAR_LABELS[pendingType]}</button></div></dialog></div> : null}
  </div>;
}
