import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityDetail } from "@/components/entity-detail";
import { WikiHeader } from "@/components/wiki-header";
import { getCampaign, getEntityDetail } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ campaignId: string; entityId: string }> }) {
  const { campaignId, entityId } = await params;
  let campaign;
  let detail;
  try {
    [campaign, detail] = await Promise.all([getCampaign(campaignId), getEntityDetail(campaignId, entityId)]);
  } catch { notFound(); }
  return (
    <>
      <WikiHeader campaignId={campaignId} campaignName={campaign.name} />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
        <Link className="text-sm text-[var(--accent)]" href={`/campaigns/${campaignId}`}>← Campaign home</Link>
        <div className="mt-8"><EntityDetail campaignId={campaignId} detail={detail} /></div>
      </main>
    </>
  );
}
