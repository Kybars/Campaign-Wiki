import { CampaignLibrary } from "@/components/campaign-library";
import { getCampaigns } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  let campaignLoadFailed = false;
  try { campaigns = await getCampaigns(); } catch (loadError) { campaignLoadFailed = true; console.error("Could not load campaigns", loadError); }
  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-14 sm:px-6 sm:py-18"><CampaignLibrary campaigns={campaigns} loadFailed={campaignLoadFailed} heading="Campaigns" description="Open a ready wiki, follow an import in progress, or begin a new campaign." /></main>;
}
