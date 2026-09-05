import { NextResponse } from "next/server";
import { processCampaign } from "@/lib/processing/process-campaign";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  try {
    const result = await processCampaign(campaignId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Campaign processing failed", { campaignId, message: error instanceof Error ? error.message : error });
    return NextResponse.json({ ok: false, error: "We couldn't finish processing this campaign. Please try again." }, { status: 500 });
  }
}
