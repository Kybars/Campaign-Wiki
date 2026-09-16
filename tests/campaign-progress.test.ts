import { campaignProgress, isCampaignProcessingActive, keepProgressMonotonic, processingMessages } from "@/lib/campaign-progress";
import { describe, expect, it } from "vitest";

describe("campaign progress", () => {
  it("maps the existing import stages to increasing progress anchors", () => {
    expect(campaignProgress("uploaded", "12 pages extracted").value).toBeGreaterThanOrEqual(5);
    expect(campaignProgress("extracting_pages", "Uploading PDF").value).toBeGreaterThan(campaignProgress("uploaded", null).value);
    expect(campaignProgress("extracting_candidates", "Finding campaign entities").value).toBeGreaterThan(campaignProgress("extracting_pages", null).value);
    expect(campaignProgress("reconciling", "Extracting campaign relationships").value).toBeGreaterThan(campaignProgress("extracting_candidates", null).value);
    expect(campaignProgress("persisting", "Building wiki").value).toBeGreaterThan(campaignProgress("reconciling", null).value);
  });

  it("finishes only completed imports and never regresses during active polling", () => {
    expect(campaignProgress("complete", "Wiki generated").value).toBe(100);
    expect(keepProgressMonotonic(78, campaignProgress("extracting_candidates", "Finding campaign entities").value, "extracting_candidates")).toBe(78);
    expect(keepProgressMonotonic(78, campaignProgress("failed", "Processing failed").value, "failed")).toBe(78);
    expect(campaignProgress("failed", "Processing failed").value).not.toBe(100);
  });

  it("uses only product-facing loading copy and stops rotating after terminal statuses", () => {
    expect(processingMessages.join(" ").toLowerCase()).not.toMatch(/openai|luna|model|provider|checkpoint|token|reconciliation|pass a/);
    expect(isCampaignProcessingActive("extracting_candidates")).toBe(true);
    expect(isCampaignProcessingActive("complete")).toBe(false);
    expect(isCampaignProcessingActive("failed")).toBe(false);
  });
});
