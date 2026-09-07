"use client";

import Link from "next/link";
import { useState } from "react";
import type { LocationTreeNode } from "@/lib/locations/hierarchy";

function LocationTreeItem({ campaignId, node, depth, ancestry }: {
  campaignId: string;
  node: LocationTreeNode;
  depth: number;
  ancestry: ReadonlySet<string>;
}) {
  const hasChildren = node.children.length > 0 && !ancestry.has(node.location.id);
  const [expanded, setExpanded] = useState(depth === 0);
  const nextAncestry = new Set(ancestry).add(node.location.id);

  return (
    <li className="min-w-0" style={{ marginInlineStart: `${Math.min(depth, 4) * 0.75}rem` }}>
      <div className="flex min-w-0 items-start gap-2 py-1.5">
        {hasChildren ? (
          <button
            aria-controls={`location-children-${node.location.id}`}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.location.name}`}
            className="mt-0.5 shrink-0 rounded px-1 text-[var(--muted)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </button>
        ) : <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 text-center text-[var(--line)]">•</span>}
        <Link className={`min-w-0 break-words font-semibold hover:text-[var(--accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${depth === 0 ? "font-serif text-lg" : ""}`} href={`/campaigns/${campaignId}/entities/${node.location.id}`}>{node.location.name}</Link>
      </div>
      {hasChildren && expanded ? (
        <ul className="m-0 list-none p-0" id={`location-children-${node.location.id}`}>
          {node.children.map((child) => <LocationTreeItem ancestry={nextAncestry} campaignId={campaignId} depth={depth + 1} key={child.location.id} node={child} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function LocationTree({ campaignId, roots }: { campaignId: string; roots: LocationTreeNode[] }) {
  if (roots.length === 0) return <p className="text-[var(--muted)]">No locations have been discovered yet.</p>;
  return (
    <ul className="m-0 list-none space-y-2 p-0" aria-label="Location hierarchy">
      {roots.map((root) => <LocationTreeItem ancestry={new Set()} campaignId={campaignId} depth={0} key={root.location.id} node={root} />)}
    </ul>
  );
}
