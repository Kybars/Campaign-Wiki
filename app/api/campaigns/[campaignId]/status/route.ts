import { NextResponse } from "next/server";
import { getCampaign } from "@/lib/db/queries";

export async function GET(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  try {
    const campaign = await getCampaign(campaignId);
    return NextResponse.json({
      status: campaign.status,
      stage: campaign.processing_stage,
      error: campaign.status === "failed" ? "We couldn't finish processing this campaign. Please try again." : null,
    });
  } catch {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
}
