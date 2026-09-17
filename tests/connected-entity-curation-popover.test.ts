import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectedEntityConnectionCard, connectionVisibilityBlockers, updateConnectedEntity } from "@/components/connected-entity-curation-popover";
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
  it("renders its DM trigger but exposes no curation control in Player View", () => {
    const dm = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail(), viewMode: "dm" }));
    const player = renderToStaticMarkup(createElement(EntityDetail, { campaignId: "campaign", detail: detail(), viewMode: "player" }));

    expect(dm).toContain("Manage Hidden forest");
    expect(player).not.toContain("Manage Hidden forest");
    expect(player).not.toContain("Player visible");
    expect(player).not.toContain("Curation for Hidden forest");
  });

  it("keeps the popup compact while restoring independent relationship controls beneath the entity", () => {
    const card = renderToStaticMarkup(createElement(ConnectedEntityConnectionCard, {
      campaignId: "campaign",
      currentEntity,
      initialRelatedEntity: hiddenRelatedEntity,
      relationships: relationships.map((relationship) => ({ ...relationship, description: "", sources: [] })),
    }));

    expect(card).toContain("Location · Supporting");
    expect(card).toContain("Player visible");
    expect(card).not.toContain("Hidden forest prominence");
    expect(card).not.toContain(">Relationships<");
    expect(card).toContain("Holds sway over");
    expect(card).toContain("Protects");
    expect(card).toContain('aria-label="Relationship hidden in Player View"');
    expect(card).toContain('aria-label="Relationship visible in Player View"');
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
});
