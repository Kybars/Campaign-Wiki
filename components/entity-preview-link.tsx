"use client";

import Link from "next/link";
import { useState } from "react";
import { ENTITY_TYPE_SINGULAR_LABELS } from "@/lib/entities";
import type { EntityType } from "@/lib/db/types";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";

export interface EntityPreview {
  id: string;
  name: string;
  type: EntityType;
  summary?: string;
  quickFacts?: string[];
}

export function EntityPreviewLink({ campaignId, entity, viewMode, className = "" }: { campaignId: string; entity: EntityPreview; viewMode: CampaignViewMode; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Link className={`font-semibold text-[var(--accent)] underline decoration-[var(--line)] underline-offset-2 hover:decoration-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`} href={campaignHref(`/campaigns/${campaignId}/entities/${entity.id}`, viewMode)} onBlur={() => setOpen(false)} onFocus={() => setOpen(true)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>{entity.name}</Link>
    {open ? <span role="tooltip" className="absolute z-10 left-0 top-full mt-2 w-64 rounded-lg border border-[var(--line)] bg-white p-3 text-left text-sm text-[var(--ink)] shadow-lg">
      <span className="block font-serif font-semibold">{entity.name}</span><span className="block text-xs font-bold uppercase tracking-wide text-[var(--accent)]">{ENTITY_TYPE_SINGULAR_LABELS[entity.type]}</span>
      {entity.quickFacts?.length ? <span className="mt-2 block text-[var(--muted)]">{entity.quickFacts.join(" · ")}</span> : null}
      {entity.summary ? <span className="mt-2 block leading-5 text-[var(--muted)]">{entity.summary}</span> : null}
    </span> : null}
  </>;
}
