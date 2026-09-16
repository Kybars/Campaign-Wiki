import { CampaignLibrary, campaignStatusLabels } from "@/components/campaign-library";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("CampaignLibrary", () => {
  it("renders a ready campaign as a link to its wiki", () => {
    const page = renderToStaticMarkup(createElement(CampaignLibrary, { loadFailed: false, campaigns: [{ id: "campaign-1", name: "The Long Road", status: "complete", error_message: null, processing_stage: null, created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z", entityCount: 12 }] }));
    expect(page).toContain('href="/campaigns/campaign-1"');
    expect(page).toContain("12 wiki entries");
    expect(page).toContain(campaignStatusLabels.complete);
  });

  it("keeps internal failure details out of campaign cards", () => {
    const page = renderToStaticMarkup(createElement(CampaignLibrary, { loadFailed: false, campaigns: [{ id: "campaign-2", name: "Failed campaign", status: "failed", error_message: "OpenAI 429: model credits exhausted", processing_stage: "Reconciliation", created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z", entityCount: 0 }] }));
    expect(page).toContain(campaignStatusLabels.failed);
    expect(page).toContain("The import could not be completed.");
    expect(page).not.toContain("OpenAI 429");
    expect(page).not.toContain("credits exhausted");
    expect(page).not.toContain("Reconciliation");
  });

  it("offers an import action for an empty library", () => {
    const page = renderToStaticMarkup(createElement(CampaignLibrary, { loadFailed: false, campaigns: [] }));
    expect(page).toContain('href="/#import"');
    expect(page).toContain("Begin with your campaign material.");
  });
});
