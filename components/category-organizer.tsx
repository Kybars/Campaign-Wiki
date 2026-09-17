"use client";

import Link from "next/link";
import { useState, type DragEvent } from "react";
import { EntityVisibilityToggle } from "@/components/curation-controls";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";
import { PROMINENCE_GROUPS, prominenceGroup, prominenceGroupLabel } from "@/lib/entities";
import type { EntityType } from "@/lib/db/types";
import type { EntityProminence, KnowledgeVisibility, QuestStatus } from "@/lib/knowledge/types";

const questGroups = ["ongoing", "not_started", "finished"] as const;
type Entry = { id: string; name: string; type: EntityType; summary: string; prominence: EntityProminence | null; visibility: KnowledgeVisibility; quest_status: QuestStatus | null };

function startEntityDrag(event: DragEvent<HTMLLIElement>, entry: Entry, setDragged: (id: string) => void) {
  if (event.target instanceof Element && event.target.closest("button, summary, select, input, [role='switch']")) {
    event.preventDefault();
    return;
  }

  setDragged(entry.id);
  const preview = document.createElement("div");
  preview.textContent = `⋮⋮  ${entry.name}`;
  preview.setAttribute("aria-hidden", "true");
  preview.style.cssText = "position:fixed;top:-10000px;left:-10000px;display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);font:600 14px Arial,sans-serif;box-shadow:0 2px 8px #0002";
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 12, 16);
  window.requestAnimationFrame(() => preview.remove());
}

export function CategoryOrganizer({ campaignId, entries: initialEntries, viewMode, grouping = "prominence" }: { campaignId: string; entries: Entry[]; viewMode: CampaignViewMode; grouping?: "prominence" | "quest_status" }) {
  const [entries, setEntries] = useState(initialEntries);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Player View is read-only. Render directly from the newly server-approved
  // props so a preserved client instance can never display its old DM list.
  const displayedEntries = viewMode === "player"
    ? initialEntries.filter((entry) => entry.visibility === "player_visible")
    : entries;
  const groups = grouping === "quest_status" ? questGroups : PROMINENCE_GROUPS;
  const groupOf = (entry: Entry) => grouping === "quest_status" ? entry.quest_status ?? "not_started" : prominenceGroup(entry.prominence);
  const label = (group: string) => grouping === "quest_status" ? ({ ongoing: "Ongoing", not_started: "Not started", finished: "Finished" }[group] ?? group) : prominenceGroupLabel(group as typeof PROMINENCE_GROUPS[number]);
  const move = async (entityId: string, group: string) => {
    const previous = entries;
    const value = group;
    setEntries((current) => current.map((entry) => entry.id === entityId ? { ...entry, ...(grouping === "quest_status" ? { quest_status: value as QuestStatus | null } : { prominence: value as EntityProminence | null }) } : entry));
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/curation`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "entity", entityId, patch: { field: grouping, value } }) });
    if (!response.ok) { const result = await response.json() as { error?: string }; setEntries(previous); setError(result.error ?? "Could not save this change"); }
  };

  return <div className="mt-4">
    {error ? <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const grouped = displayedEntries.filter((entry) => groupOf(entry) === group).toSorted((left, right) => left.name.localeCompare(right.name));
        if (viewMode === "player" && grouped.length === 0) return null;
        return <section className="min-w-0 rounded-lg border border-[var(--line)] bg-white/55" key={group} onDragOver={(event) => { if (viewMode === "dm") event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (dragged) void move(dragged, group); setDragged(null); }}>
          <h2 className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] px-3 py-2 font-serif text-lg font-semibold">{label(group)} <span className="font-sans text-xs font-normal text-[var(--muted)]">{grouped.length}</span></h2>
          <ul>
            {grouped.map((entry) => <li className={`flex min-w-0 items-center gap-2 border-b border-[var(--line)]/70 px-3 py-2 last:border-b-0 ${dragged === entry.id ? "bg-white/70 opacity-60" : ""}`} draggable={viewMode === "dm"} key={entry.id} onDragEnd={() => setDragged(null)} onDragStart={(event) => startEntityDrag(event, entry, setDragged)}>
              {viewMode === "dm" ? <span aria-hidden="true" className="cursor-grab select-none text-xs text-[var(--muted)]">⋮⋮</span> : null}
              <Link className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-[var(--accent)] hover:underline" draggable={false} href={campaignHref(`/campaigns/${campaignId}/entities/${entry.id}`, viewMode)}>{entry.name}</Link>
              {viewMode === "dm" ? <>
                <details className="group relative hidden shrink-0 md:block">
                  <summary aria-label={`Move ${entry.name}`} className="grid size-7 cursor-pointer list-none place-items-center rounded text-lg leading-none text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">…</summary>
                  <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-[var(--line)] bg-white p-2 shadow-lg">
                    <label className="block text-xs font-semibold text-[var(--muted)]">Move to {grouping === "quest_status" ? "status" : "prominence"}
                      <select aria-label={`Move ${entry.name} to ${grouping === "quest_status" ? "quest status" : "prominence"}`} className="mt-1 w-full rounded border border-[var(--line)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]" onChange={(event) => void move(entry.id, event.target.value)} value={groupOf(entry)}>{groups.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select>
                    </label>
                  </div>
                </details>
                <label className="shrink-0 md:hidden"><span className="sr-only">Move {entry.name}</span>
                  <select aria-label={`Move ${entry.name} to ${grouping === "quest_status" ? "quest status" : "prominence"}`} className="max-w-24 rounded border border-[var(--line)] bg-white px-1 py-0.5 text-xs text-[var(--muted)]" onChange={(event) => void move(entry.id, event.target.value)} value={groupOf(entry)}>{groups.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select>
                </label>
                <EntityVisibilityToggle campaignId={campaignId} entityId={entry.id} initialVisibility={entry.visibility} label={entry.name} />
              </> : null}
            </li>)}
            {grouped.length === 0 ? <li className="px-3 py-3 text-xs text-[var(--muted)]">Drop entries here.</li> : null}
          </ul>
        </section>;
      })}
    </div>
  </div>;
}
