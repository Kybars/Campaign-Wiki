import { NextResponse } from "next/server";
import { campaignViewMode } from "@/lib/campaign-view";
import { searchCampaignEntities } from "@/lib/db/queries";

export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params; const { searchParams } = new URL(request.url); const term = searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) return NextResponse.json([]);
  const results = await searchCampaignEntities(campaignId, term, campaignViewMode(searchParams.get("view"))).catch(() => []);
  return NextResponse.json(results.slice(0, 8).map(({ id, name, type, aliases }) => ({ id, name, type, aliases })));
}
