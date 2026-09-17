import { notFound, redirect } from "next/navigation";
import { CampaignBreadcrumbs } from "@/components/campaign-breadcrumbs";
import { EntityDetail } from "@/components/entity-detail";
import { CampaignShell } from "@/components/wiki-header";
import { campaignEntityExists, getCampaign, getCampaignNavigation, getEntityDetail } from "@/lib/db/queries";
import { campaignViewMode, shouldRedirectHiddenPlayerPage } from "@/lib/campaign-view";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params, searchParams }: { params: Promise<{ campaignId: string; entityId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { campaignId, entityId } = await params;
  const viewMode = campaignViewMode((await searchParams).view);
  let campaign;
  let detail;
  try { campaign = await getCampaign(campaignId, viewMode); } catch { notFound(); }
  try { detail = await getEntityDetail(campaignId, entityId, viewMode); }
  catch {
    const existing = await campaignEntityExists(campaignId, entityId);
    if (shouldRedirectHiddenPlayerPage(viewMode, Boolean(existing), false)) redirect(`/campaigns/${campaignId}?view=player&notice=not-visible`);
    notFound();
  }
  const navigation = await getCampaignNavigation(campaignId, viewMode);
  const category = { label: ENTITY_TYPE_LABELS[detail.entity.type], path: detail.entity.type };
  return (
    <CampaignShell active={detail.entity.type} availableCategories={navigation} campaignId={campaignId} campaignName={campaign.name} viewMode={viewMode} currentPath={`/campaigns/${campaignId}/entities/${entityId}`}>
      <main className="px-4 py-5 sm:px-6 sm:py-7">
        <CampaignBreadcrumbs campaignId={campaignId} campaignName={campaign.name} category={category} current={detail.entity.name} viewMode={viewMode} />
        <div className="mt-5"><EntityDetail campaignId={campaignId} detail={detail} viewMode={viewMode} /></div>
      </main>
    </CampaignShell>
  );
}
