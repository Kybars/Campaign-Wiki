import { describe, expect, it } from "vitest";
import { campaignHref } from "@/lib/campaign-view";
import { overviewCategoryCounts, overviewSummary, selectProminentOverviewEntries, selectQuestOverviewEntries, type OverviewEntry } from "@/lib/overview-selection";

const entry = (id: string, overrides: Partial<OverviewEntry> = {}): OverviewEntry => ({ id, name: id, type: "npc", roles: [], aliases: [], visibility: "player_visible", prominence: "minor", quest_status: null, summary: "", ...overrides });

describe("overview selection", () => {
  it("puts Major NPCs before Supporting NPCs and bounds the row without minor filler", () => {
    const entries = [entry("Zara", { prominence: "supporting" }), entry("Bryn", { prominence: "major" }), entry("Ari", { prominence: "major" }), entry("Minor", { prominence: "minor" }), ...Array.from({ length: 4 }, (_, index) => entry(`Support ${index}`, { prominence: "supporting" }))];
    expect(selectProminentOverviewEntries(entries, "npc", "dm", 5).map((item) => item.name)).toEqual(["Ari", "Bryn", "Support 0", "Support 1", "Support 2"]);
  });

  it("selects Major Locations and Major Factions with stable alphabetical ties", () => {
    const entries = [entry("Zion", { type: "location", prominence: "major" }), entry("Abbey", { type: "location", prominence: "major" }), entry("Guild", { type: "faction", prominence: "supporting" }), entry("Council", { type: "faction", prominence: "major" })];
    expect(selectProminentOverviewEntries(entries, "location", "dm").map((item) => item.name)).toEqual(["Abbey", "Zion"]);
    expect(selectProminentOverviewEntries(entries, "faction", "dm").map((item) => item.name)).toEqual(["Council", "Guild"]);
  });

  it("puts ongoing quests first and never uses finished quests as filler", () => {
    const entries = [entry("Later", { type: "quest", quest_status: "not_started" }), entry("Active", { type: "quest", quest_status: "ongoing" }), entry("Complete", { type: "quest", quest_status: "finished" })];
    expect(selectQuestOverviewEntries(entries, "dm").map((item) => item.name)).toEqual(["Active", "Later"]);
  });

  it("counts only visible non-empty exploration categories in Player View", () => {
    const entries = [entry("Public item", { type: "item" }), entry("Secret item", { type: "item", visibility: "dm_only" }), entry("Public event", { type: "event" }), entry("Secret deity", { type: "deity", visibility: "dm_only" })];
    expect(overviewCategoryCounts(entries, "player", ["item", "event", "deity", "other"])).toEqual([{ type: "item", count: 1 }, { type: "event", count: 1 }]);
    expect(selectProminentOverviewEntries([entry("Secret NPC", { prominence: "major", visibility: "dm_only" })], "npc", "player")).toEqual([]);
  });

  it("preserves Player View on overview links and leaves absent summaries absent", () => {
    expect(campaignHref("/campaigns/c/categories/npc", "player")).toBe("/campaigns/c/categories/npc?view=player");
    expect(overviewSummary(entry("No summary").summary)).toBeNull();
    expect(overviewSummary("  A source-backed line. ")).toBe("A source-backed line.");
  });
});
