import { CampaignOverview } from "@/components/campaign-overview";
import { EntityDetail, type EntityDetailView } from "@/components/entity-detail";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const campaignId = "campaign-1";

describe("Milestone 6 read experiences", () => {
  it("renders a persisted overview only when one exists, with compact evidence", () => {
    const withOverview = renderToStaticMarkup(createElement(CampaignOverview, { overview: "A public campaign premise.", evidence: [{ id: "evidence", document_id: "doc", filename: "Campaign.pdf", page_number: 3, supporting_text: "The public campaign premise." }] }));
    expect(withOverview).toContain("Campaign overview");
    expect(withOverview).toContain("Evidence [p. 3]");
    expect(renderToStaticMarkup(createElement(CampaignOverview, { overview: null, evidence: [] }))).toBe("");
  });

  it("makes Quest facts and canonical reference links easy to scan without placeholders", () => {
    const detail: EntityDetailView = {
      entity: { id: "quest", name: "Relight the Beacon", type: "quest", aliases: [], roles: [], summary: "Restore the beacon." },
      facts: [{ id: "objective", fieldKey: "objective", content: "Relight the beacon", sortOrder: 0, evidence: [] }, { id: "stakes", fieldKey: "stakes", content: "Keep the harbor safe", sortOrder: 1, evidence: [] }],
      relationships: [
        { id: "giver", description: "", displayLabel: "questgiver for", relationship_type: "questgiver_for", relatedEntity: { id: "mira", name: "Mira", type: "npc" }, sources: [] },
        { id: "place", description: "", displayLabel: "concerns", relationship_type: "concerns", relatedEntity: { id: "emberwatch", name: "Emberwatch", type: "location" }, sources: [] },
      ], sources: [],
    };
    const page = renderToStaticMarkup(createElement(EntityDetail, { campaignId, detail, viewMode: "player" }));
    expect(page).toContain("Objective.");
    expect(page).toContain("Questgiver");
    expect(page).toContain(`href="/campaigns/${campaignId}/entities/mira?view=player"`);
    expect(page).toContain("Important locations");
    expect(page).not.toContain("Reward</h2>");
  });
});
