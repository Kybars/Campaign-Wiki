import Link from "next/link";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";

export function CampaignBreadcrumbs({ campaignId, campaignName, viewMode, category, current }: { campaignId: string; campaignName: string; viewMode: CampaignViewMode; category?: { label: string; path: string }; current?: string }) {
  return <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]"><Link className="font-semibold text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}`, viewMode)}>{campaignName}</Link>{category ? <><span aria-hidden="true">›</span>{current ? <Link className="font-semibold text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/categories/${category.path}`, viewMode)}>{category.label}</Link> : <span aria-current="page">{category.label}</span>}</> : null}{current ? <><span aria-hidden="true">›</span><span aria-current="page">{current}</span></> : null}</nav>;
}
