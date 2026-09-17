import { CategoryOrganizer } from "@/components/category-organizer";
import { EntityCurationControls } from "@/components/curation-controls";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const entries = [
  { id: "mira", name: "Mira", type: "npc" as const, summary: "A trusted guide.", prominence: "major" as const, visibility: "player_visible" as const, quest_status: "ongoing" as const },
  { id: "leska", name: "Leska", type: "npc" as const, summary: "The secret villain.", prominence: "major" as const, visibility: "dm_only" as const, quest_status: "ongoing" as const },
  { id: "vault", name: "Hidden Vault", type: "npc" as const, summary: "A concealed location.", prominence: "minor" as const, visibility: "dm_only" as const, quest_status: "finished" as const },
];

function render(viewMode: "dm" | "player", grouping: "prominence" | "quest_status") {
  return renderToStaticMarkup(createElement(CategoryOrganizer, { campaignId: "campaign", entries, grouping, viewMode }));
}

describe("CategoryOrganizer Player View transitions", () => {
  it.each(["prominence", "quest_status"] as const)("drops stale DM entries for %s grouping and restores them in DM View", (grouping) => {
    const dmBefore = render("dm", grouping);
    expect(dmBefore).toContain("Mira");
    expect(dmBefore).toContain("Leska");
    expect(dmBefore).toContain("Hidden Vault");
    expect(dmBefore).toContain("grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3");
    expect(dmBefore).toContain('draggable="true"');
    expect(dmBefore).toContain('class="min-w-0 flex-1 truncate text-sm font-semibold');
    expect(dmBefore).toContain('draggable="false"');
    expect(dmBefore).toContain(`aria-label="Move Mira"`);
    expect(dmBefore).toContain('aria-label="Hide Mira from players"');
    expect(dmBefore).toContain('title="Visible to players"');
    expect(dmBefore).toContain('aria-label="Show Leska to players"');
    expect(dmBefore).toContain('title="Hidden from players"');
    expect(dmBefore).toContain('role="switch"');
    expect(dmBefore).toContain("hidden shrink-0 md:block");
    expect(dmBefore).toContain("shrink-0 md:hidden");
    expect(dmBefore).toContain(grouping === "quest_status" ? "Finished" : "Supporting");
    expect(dmBefore).not.toContain("Unclassified");

    // Use the previous DM list deliberately: this models a preserved client state.
    const player = render("player", grouping);
    expect(player).toContain("Mira");
    expect(player).not.toContain("A trusted guide.");
    expect(player).not.toContain("Leska");
    expect(player).not.toContain("Hidden Vault");
    expect(player).not.toContain("The secret villain.");
    expect(player).not.toContain("A concealed location.");
    expect(player).not.toContain('href="/campaigns/campaign/entities/leska?view=player"');
    expect(player).not.toContain('href="/campaigns/campaign/entities/vault?view=player"');
    expect(player).not.toContain("cursor-grab");
    expect(player).not.toContain('draggable="true"');
    expect(player).not.toContain("aria-label=\"Move Mira\"");
    expect(player).not.toContain('role="switch"');

    const dmAfter = render("dm", grouping);
    expect(dmAfter).toContain("Mira");
    expect(dmAfter).toContain("Leska");
    expect(dmAfter).toContain("Hidden Vault");
  });

  it("places legacy null values in Minor or Not started without exposing an Unclassified group", () => {
    const legacyEntries = [{ ...entries[0], prominence: null, quest_status: null }];
    const prominence = renderToStaticMarkup(createElement(CategoryOrganizer, { campaignId: "campaign", entries: legacyEntries, grouping: "prominence", viewMode: "dm" }));
    const status = renderToStaticMarkup(createElement(CategoryOrganizer, { campaignId: "campaign", entries: legacyEntries, grouping: "quest_status", viewMode: "dm" }));
    expect(prominence).toMatch(/Minor[\s\S]*Mira/);
    expect(status).toMatch(/Not started[\s\S]*Mira/);
    expect(prominence).not.toContain("Unclassified");
    expect(status).not.toContain("Unclassified");
  });

  it("omits Unclassified from the entity-detail prominence and quest-status editors", () => {
    const controls = renderToStaticMarkup(createElement(EntityCurationControls, { campaignId: "campaign", entity: { id: "quest", name: "Save the Gate", type: "quest", prominence: null, quest_status: null } }));
    expect(controls).toContain('>Minor</button>');
    expect(controls).toContain('>Not started</button>');
    expect(controls).not.toContain("Unclassified");
  });
});
