import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityDetail } from "@/components/entity-detail";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, getEntityDetail } from "@/lib/db/queries";
import { campaignHref, campaignViewMode } from "@/lib/campaign-view";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params, searchParams }: { params: Promise<{ campaignId: string; entityId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { campaignId, entityId } = await params;
  const viewMode = campaignViewMode((await searchParams).view);
  let campaign;
  let detail;
  try {
    [campaign, detail] = await Promise.all([getCampaign(campaignId, viewMode), getEntityDetail(campaignId, entityId, viewMode)]);
  } catch { notFound(); }
  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} currentPath={`/campaigns/${campaignId}/entities/${entityId}`} />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
        <Link className="text-sm text-[var(--accent)]" href={campaignHref(`/campaigns/${campaignId}`, viewMode)}>← Campaign home</Link>
        <div className="mt-8"><EntityDetail campaignId={campaignId} detail={detail} viewMode={viewMode} /></div>
      </main>
    </>
  );
}
