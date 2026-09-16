"use client";

import { useEffect, useRef, useState } from "react";
import { conciseRelationshipExcerpt } from "@/lib/relationships/evidence";
import { groupSourceEvidence, sourceReference, type SourceEvidence } from "@/lib/wiki/source-presentation";

export function EvidencePopover({ sources, label, anchors = [] }: { sources: SourceEvidence[]; label: string; anchors?: string[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);
  if (!sources.length) return null;
  const groups = groupSourceEvidence(sources);
  return <span className="relative inline-block align-baseline text-xs text-[var(--muted)]" ref={rootRef}>
    <button aria-expanded={open} aria-haspopup="dialog" aria-label={`${open ? "Hide" : "Show"} evidence for ${label}: ${sourceReference(sources)}`} className="inline rounded px-1 font-semibold text-[var(--accent)] underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={() => setOpen((current) => !current)} ref={buttonRef} type="button">{sourceReference(sources)}</button>
    {open ? <span aria-label={`Evidence for ${label}`} className="absolute right-0 z-20 mt-2 block w-96 max-w-[calc(100vw-3rem)] rounded-lg border border-[var(--line)] bg-white p-3 text-left shadow-lg" role="dialog">
      {groups.map((document) => <span className="mb-3 block last:mb-0" key={document.documentId}><span className="block font-semibold text-[var(--ink)]">{document.filename}</span>{document.pages.map((page) => <span className="mt-2 block" key={page.pageNumber}><span className="block font-semibold">Page {page.pageNumber}</span>{page.sources.map((source) => {
        const excerpt = conciseRelationshipExcerpt(source.supporting_text, anchors, label);
        const isExpanded = expanded.has(source.id);
        return <span className="mt-1 block border-l-2 border-[var(--accent)] pl-2 leading-5" key={source.id}>“{isExpanded ? source.supporting_text : excerpt}”{excerpt !== source.supporting_text ? <button className="ml-1 font-semibold text-[var(--accent)] underline" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(source.id)) next.delete(source.id); else next.add(source.id); return next; })} type="button">{isExpanded ? "Show less" : "Show more"}</button> : null}</span>;
      })}</span>)}</span>)}
    </span> : null}
  </span>;
}
