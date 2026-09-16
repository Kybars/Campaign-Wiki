"use client";

import Link from "next/link";
import { useState } from "react";
import { EntityVisibilityToggle } from "@/components/curation-controls";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";
import { PROMINENCE_GROUPS, prominenceGroup, prominenceGroupLabel } from "@/lib/entities";
import type { EntityType } from "@/lib/db/types";
import type { EntityProminence, KnowledgeVisibility, QuestStatus } from "@/lib/knowledge/types";

const questGroups = ["ongoing", "not_started", "finished", "unclassified"] as const;
type Entry = { id: string; name: string; type: EntityType; summary: string; prominence: EntityProminence | null; visibility: KnowledgeVisibility; quest_status: QuestStatus | null };

export function CategoryOrganizer({ campaignId, entries: initialEntries, viewMode, grouping = "prominence" }: { campaignId: string; entries: Entry[]; viewMode: CampaignViewMode; grouping?: "prominence" | "quest_status" }) {
  const [entries, setEntries] = useState(initialEntries);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState("");
  const groups = grouping === "quest_status" ? questGroups : PROMINENCE_GROUPS;
  const groupOf = (entry: Entry) => grouping === "quest_status" ? entry.quest_status ?? "unclassified" : prominenceGroup(entry.prominence);
  const label = (group: string) => grouping === "quest_status" ? ({ ongoing: "Ongoing", not_started: "Not started", finished: "Finished", unclassified: "Unclassified" }[group] ?? group) : prominenceGroupLabel(group as typeof PROMINENCE_GROUPS[number]);
  const move = async (entityId: string, group: string) => {
    const previous = entries;
    const value = group === "unclassified" ? null : group;
    setEntries((current) => current.map((entry) => entry.id === entityId ? { ...entry, ...(grouping === "quest_status" ? { quest_status: value as QuestStatus | null } : { prominence: value as EntityProminence | null }) } : entry));
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/curation`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "entity", entityId, patch: { field: grouping, value } }) });
    if (!response.ok) { const result = await response.json() as { error?: string }; setEntries(previous); setError(result.error ?? "Could not save this change"); }
  };
  return <div className="mt-8 space-y-5">{error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}{groups.map((group) => {
    const grouped = entries.filter((entry) => groupOf(entry) === group).toSorted((left, right) => left.name.localeCompare(right.name));
    if (viewMode === "player" && grouped.length === 0) return null;
    return <section className="rounded-xl border border-[var(--line)] bg-white/55" key={group} onDragOver={(event) => { if (viewMode === "dm") event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (dragged) void move(dragged, group); setDragged(null); }}><h2 className="border-b border-[var(--line)] px-4 py-3 font-serif text-2xl font-semibold">{label(group)} <span className="font-sans text-sm font-normal text-[var(--muted)]">({grouped.length})</span></h2><ul>{grouped.map((entry) => <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)]/70 px-4 py-3 last:border-b-0" draggable={viewMode === "dm"} key={entry.id} onDragEnd={() => setDragged(null)} onDragStart={() => setDragged(entry.id)}>{viewMode === "dm" ? <span aria-hidden="true" className="cursor-grab select-none text-[var(--muted)]">⋮⋮</span> : null}<div className="min-w-0 flex-1"><Link className="font-semibold hover:text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}/entities/${entry.id}`, viewMode)}>{entry.name}</Link>{entry.summary ? <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{entry.summary}</p> : null}</div>{viewMode === "dm" ? <><label className="text-xs text-[var(--muted)]"><span className="sr-only">Move {entry.name}</span><select aria-label={`Move ${entry.name} to ${grouping === "quest_status" ? "quest status" : "prominence"}`} className="rounded border border-[var(--line)] bg-white px-2 py-1" onChange={(event) => void move(entry.id, event.target.value)} value={groupOf(entry)}>{groups.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label><EntityVisibilityToggle campaignId={campaignId} entityId={entry.id} initialVisibility={entry.visibility} label={entry.name} /></> : null}</li>)}{grouped.length === 0 ? <li className="px-4 py-5 text-sm text-[var(--muted)]">Drop entries here or use an entry’s selection menu.</li> : null}</ul></section>;
  })}</div>;
}
