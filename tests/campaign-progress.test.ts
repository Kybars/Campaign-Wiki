import { campaignProgress, campaignProgressDisplay, isCampaignProcessingActive, keepProgressMonotonic, parseCampaignProgress, processingMessages } from "@/lib/campaign-progress";
import { describe, expect, it } from "vitest";

describe("campaign progress", () => {
  it("calculates each measurable phase within its stable range", () => {
    expect(campaignProgress("preparing", 1, 1).percentage).toBe(5);
    expect(campaignProgress("reading", 1, 2).percentage).toBe(10);
    expect(campaignProgress("finding_information", 5, 8).percentage).toBe(27);
    expect(campaignProgress("extracting_connections", 3, 4).percentage).toBe(46);
    expect(campaignProgress("matching_entities", 6, 10).percentage).toBe(60);
    expect(campaignProgress("checking_connections", 3, 5).percentage).toBe(76);
    expect(campaignProgress("tidying_connections", 4, 7).percentage).toBe(88);
    expect(campaignProgress("building_wiki", 1, 1).percentage).toBe(99);
  });

  it("keeps phase transitions and later-discovered totals monotonic", () => {
    const finding = campaignProgress("finding_information", 8, 8);
    const connections = campaignProgress("extracting_connections", 0, 12, "sections", finding.percentage);
    const gaps = campaignProgress("checking_connections", 0, 5, "batches", connections.percentage);
    expect(connections.percentage).toBeGreaterThanOrEqual(finding.percentage);
    expect(gaps.percentage).toBeGreaterThanOrEqual(connections.percentage);
    expect(keepProgressMonotonic(76, campaignProgress("checking_connections", 0, 20).percentage, "reconciling")).toBe(76);
  });

  it("retains persisted progress on failure, refresh, and completes only at 100", () => {
    const stored = { phase: "checking_connections", completedUnits: 3, totalUnits: 5, unitType: "batches", percentage: 76 };
    expect(parseCampaignProgress(stored, "failed")).toMatchObject(stored);
    expect(campaignProgressDisplay(stored, "failed").label).toBe("Import paused");
    expect(campaignProgressDisplay(stored).detail).toBe("3 / 5 batches");
    expect(keepProgressMonotonic(76, 50, "failed")).toBe(76);
    expect(parseCampaignProgress(stored, "complete").percentage).toBe(100);
  });

  it("handles zero and unknown totals without pretending work completed", () => {
    expect(campaignProgress("matching_entities", 0, 0, "batches").percentage).toBe(50);
    expect(campaignProgress("tidying_connections", 0, null, "batches").percentage).toBe(82);
  });

  it("uses only product-facing loading copy and stops rotating after terminal statuses", () => {
    expect(processingMessages.join(" ").toLowerCase()).not.toMatch(/openai|luna|model|provider|checkpoint|token|reconciliation|pass a/);
    expect(isCampaignProcessingActive("extracting_candidates")).toBe(true);
    expect(isCampaignProcessingActive("complete")).toBe(false);
    expect(isCampaignProcessingActive("failed")).toBe(false);
  });
});
