import { describe, expect, it } from "vitest";
import { campaignHref } from "@/lib/campaign-view";
import { overviewCategoryCounts, overviewSummary, selectProminentOverviewEntries, selectQuestOverviewEntries, type OverviewEntry } from "@/lib/overview-selection";

const entry = (id: string, overrides: Partial<OverviewEntry> = {}): OverviewEntry => ({ id, name: id, type: "npc", roles: [], aliases: [], visibility: "player_visible", prominence: "minor", quest_status: null, summary: "", ...overrides });

describe("overview selection", () => {
  it("shows at most four alphabetized Major NPCs without Supporting filler", () => {
    const entries = [entry("Supporting", { prominence: "supporting" }), entry("Minor", { prominence: "minor" }), ...["Zara", "Bryn", "Eli", "Ari", "Dara"].map((name) => entry(name, { prominence: "major" }))];
    expect(selectProminentOverviewEntries(entries, "npc", "dm").map((item) => item.name)).toEqual(["Ari", "Bryn", "Dara", "Eli"]);
  });

  it("selects only Major Locations and Major Factions with stable alphabetical ties", () => {
    const entries = [entry("Zion", { type: "location", prominence: "major" }), entry("Abbey", { type: "location", prominence: "major" }), entry("Guild", { type: "faction", prominence: "supporting" }), entry("Council", { type: "faction", prominence: "major" })];
    expect(selectProminentOverviewEntries(entries, "location", "dm").map((item) => item.name)).toEqual(["Abbey", "Zion"]);
    expect(selectProminentOverviewEntries(entries, "faction", "dm").map((item) => item.name)).toEqual(["Council"]);
  });

  it("shows at most four ongoing quests without Not started or finished filler", () => {
    const entries = [entry("Later", { type: "quest", quest_status: "not_started" }), entry("Complete", { type: "quest", quest_status: "finished" }), ...["Zara", "Bryn", "Eli", "Ari", "Dara"].map((name) => entry(name, { type: "quest", quest_status: "ongoing" }))];
    expect(selectQuestOverviewEntries(entries, "dm").map((item) => item.name)).toEqual(["Ari", "Bryn", "Dara", "Eli"]);
  });

  it("returns no entries for an empty strict section", () => {
    expect(selectProminentOverviewEntries([entry("Supporting", { prominence: "supporting" })], "npc", "dm")).toEqual([]);
    expect(selectQuestOverviewEntries([entry("Later", { type: "quest", quest_status: "not_started" })], "dm")).toEqual([]);
  });

  it("counts only visible non-empty exploration categories in Player View", () => {
    const entries = [entry("Public item", { type: "item" }), entry("Secret item", { type: "item", visibility: "dm_only" }), entry("Public event", { type: "event" }), entry("Secret deity", { type: "deity", visibility: "dm_only" })];
    expect(overviewCategoryCounts(entries, "player", ["item", "event", "deity", "other"])).toEqual([{ type: "item", count: 1 }, { type: "event", count: 1 }]);
    expect(selectProminentOverviewEntries([entry("Secret NPC", { prominence: "major", visibility: "dm_only" }), entry("Public supporting NPC", { prominence: "supporting" })], "npc", "player")).toEqual([]);
    expect(selectQuestOverviewEntries([entry("Secret quest", { type: "quest", quest_status: "ongoing", visibility: "dm_only" }), entry("Public future quest", { type: "quest", quest_status: "not_started" })], "player")).toEqual([]);
  });

  it("preserves Player View on overview links and leaves absent summaries absent", () => {
    expect(campaignHref("/campaigns/c/categories/npc", "player")).toBe("/campaigns/c/categories/npc?view=player");
    expect(overviewSummary(entry("No summary").summary)).toBeNull();
    expect(overviewSummary("  A source-backed line. ")).toBe("A source-backed line.");
  });
});
