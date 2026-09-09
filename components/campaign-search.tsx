"use client";

import { useEffect, useId, useRef, useState } from "react";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";
import type { EntityType } from "@/lib/db/types";

type SearchResult = { id: string; name: string; type: EntityType; aliases: string[] };

export function CampaignSearch({ campaignId, viewMode }: { campaignId: string; viewMode: CampaignViewMode }) {
  const listboxId = useId();
  const [term, setTerm] = useState(""); const [results, setResults] = useState<SearchResult[]>([]); const [open, setOpen] = useState(false); const [activeIndex, setActiveIndex] = useState(-1);
  const sequence = useRef(0);
  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) return;
    const controller = new AbortController(); const requestId = ++sequence.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/search?q=${encodeURIComponent(query)}&view=${viewMode}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search request failed");
        const nextResults = (await response.json()) as SearchResult[];
        if (requestId === sequence.current) { setResults(nextResults); setOpen(true); setActiveIndex(-1); }
      } catch (error) { if ((error as Error).name !== "AbortError" && requestId === sequence.current) { setResults([]); setOpen(false); } }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [campaignId, term, viewMode]);
  function goTo(result: SearchResult) { window.location.assign(campaignHref(`/campaigns/${campaignId}/entities/${result.id}`, viewMode)); }
  return <div className="relative">
    <label className="sr-only" htmlFor={`campaign-search-${listboxId}`}>Search this campaign</label>
    <input id={`campaign-search-${listboxId}`} value={term} onChange={(event) => setTerm(event.target.value)} onFocus={() => { if (results.length) setOpen(true); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); if (results.length) { setOpen(true); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); } }
      if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
      if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); goTo(results[activeIndex]); }
      if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); }
    }} role="combobox" aria-autocomplete="list" aria-controls={listboxId} aria-expanded={open && results.length > 0} aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined} placeholder="Search this campaign…" className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
    {term.trim().length >= 2 && open && results.length > 0 ? <ul id={listboxId} role="listbox" className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-1 shadow-lg">
      {results.map((result, index) => <li key={result.id} id={`${listboxId}-${index}`} role="option" aria-selected={activeIndex === index}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => goTo(result)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${activeIndex === index ? "bg-[var(--paper)]" : "hover:bg-[var(--paper)]"}`}><span className="font-semibold">{result.name}</span><span className="ml-2 text-xs text-[var(--muted)]">{result.type}</span>{result.aliases.length ? <span className="ml-2 text-xs text-[var(--muted)]">also {result.aliases.slice(0, 2).join(", ")}</span> : null}</button></li>)}
    </ul> : null}
  </div>;
}
