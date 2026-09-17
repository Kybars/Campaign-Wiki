import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectedEntityConnectionCard, connectionVisibilityBlockers, updateConnectedEntity } from "@/components/connected-entity-curation-popover";
import { persistOptimisticVisibilityChange } from "@/components/curation-controls";
import { EntityDetail, type EntityDetailView } from "@/components/entity-detail";

const currentEntity = { id: "current", name: "Current entity", visibility: "player_visible" as const };
const hiddenRelatedEntity = { id: "related", name: "Hidden forest", type: "location" as const, prominence: "supporting" as const, visibility: "dm_only" as const };
const relationships = [
  { id: "relationship-one", displayLabel: "Holds sway over", visibility: "dm_only" as const },
  { id: "relationship-two", displayLabel: "Protects", visibility: "player_visible" as const },
];

function detail(): EntityDetailView {
  return {
    entity: { ...currentEntity, type: "npc", aliases: [], roles: [], summary: "", prominence: "major" },
    relationships: relationships.map((relationship) => ({ ...relationship, description: "", relatedEntity: hiddenRelatedEntity, sources: [] })),
    sources: [],
  };
}

describe("connected entity curation popover", () => {
  it("uses the entity link as the DM trigger without rendering a permanent Manage button", () => {
    const dm = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail(), viewMode: "dm" }));
    const player = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail(), viewMode: "player" }));

    expect(dm).toContain('href="/campaigns/campaign/entities/related"');
    expect(dm).not.toContain("Manage Hidden forest");
    expect(dm).not.toContain(">Manage<");
    expect(player).not.toContain("Player visible");
    expect(player).not.toContain("Curation for Hidden forest");
  });

  it("limits the quick-popover trigger to the connected entity identity, leaving relationship controls outside it", () => {
    const card = renderToStaticMarkup(createElement(ConnectedEntityConnectionCard, {
      campaignId: "campaign", currentEntity, initialRelatedEntity: hiddenRelatedEntity,
      relationships: relationships.map((relationship) => ({ ...relationship, description: "", sources: [] })),
    }));

    const triggerEnd = card.indexOf('<ul class="mt-2 space-y-2">');
    expect(card.slice(0, triggerEnd)).toContain('class="relative w-fit"');
    expect(card.slice(0, triggerEnd)).toContain('aria-label="Curation for Hidden forest"');
    expect(card.slice(triggerEnd)).toContain('aria-label="Show relationship to players"');
    expect(card.slice(triggerEnd)).not.toContain('class="relative w-fit"');
  });

  it("keeps the popup compact while restoring independent relationship controls beneath the entity", () => {
    const card = renderToStaticMarkup(createElement(ConnectedEntityConnectionCard, {
      campaignId: "campaign",
      currentEntity,
      initialRelatedEntity: hiddenRelatedEntity,
      relationships: relationships.map((relationship) => ({ ...relationship, description: "", sources: [] })),
    }));

    expect(card).toContain("Location · Supporting");
    expect(card).not.toContain("Player visible");
    expect(card).not.toContain("Hidden forest prominence");
    expect(card).not.toContain(">Relationships<");
    expect(card).toContain("Holds sway over");
    expect(card).toContain("Protects");
    expect(card).toContain('aria-label="Show relationship to players"');
    expect(card).toContain('aria-label="Hide relationship from players"');
    expect(card).toContain('aria-describedby="visibility-blocked-relationship-relationship-one"');
    expect(card).toContain('role="tooltip"');
    expect(card).toContain("Hidden forest is not visible to players.");
  });

  it("immediately makes relationship visibility eligible when the related entity becomes visible", () => {
    expect(connectionVisibilityBlockers(currentEntity, hiddenRelatedEntity)).toEqual(["Hidden forest is not visible to players."]);
    const visibleRelatedEntity = updateConnectedEntity(hiddenRelatedEntity, "visibility", "player_visible");
    expect(visibleRelatedEntity.visibility).toBe("player_visible");
    expect(connectionVisibilityBlockers(currentEntity, visibleRelatedEntity)).toEqual([]);
  });

  it("updates the related entity prominence independently of its visibility", () => {
    const majorRelatedEntity = updateConnectedEntity(hiddenRelatedEntity, "prominence", "major");
    expect(majorRelatedEntity.prominence).toBe("major");
    expect(majorRelatedEntity.visibility).toBe("dm_only");
  });

  it("keeps relationships disabled when the current entity is hidden", () => {
    expect(connectionVisibilityBlockers({ ...currentEntity, visibility: "dm_only" }, { ...hiddenRelatedEntity, visibility: "player_visible" })).toEqual(["Current entity is not visible to players."]);
  });

  it("recalculates immediately for both endpoints as current visibility changes", () => {
    const visibleRelated = { ...hiddenRelatedEntity, visibility: "player_visible" as const };
    expect(connectionVisibilityBlockers({ ...currentEntity, visibility: "dm_only" }, visibleRelated)).toEqual(["Current entity is not visible to players."]);
    expect(connectionVisibilityBlockers({ ...currentEntity, visibility: "player_visible" }, visibleRelated)).toEqual([]);
    expect(connectionVisibilityBlockers({ ...currentEntity, visibility: "player_visible" }, hiddenRelatedEntity)).toEqual(["Hidden forest is not visible to players."]);
    expect(connectionVisibilityBlockers({ ...currentEntity, visibility: "dm_only" }, visibleRelated)).toEqual(["Current entity is not visible to players."]);
  });

  it("rolls the shared endpoint visibility back when its save fails", async () => {
    const changes: Array<"dm_only" | "player_visible"> = [];
    await expect(persistOptimisticVisibilityChange({
      previous: "dm_only", next: "player_visible", onVisibilityChange: (visibility) => changes.push(visibility),
      saveChange: async () => { throw new Error("Save failed"); },
    })).rejects.toThrow("Save failed");
    expect(changes).toEqual(["player_visible", "dm_only"]);
  });
});
