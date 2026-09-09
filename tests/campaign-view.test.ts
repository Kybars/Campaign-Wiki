import { describe, expect, it } from "vitest";
import { campaignHref, campaignViewMode, visibleEntities, visibleFacts, visibleRelationships, visibleSummary } from "@/lib/campaign-view";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { filterEntitiesBySearchTerm } from "@/lib/entities";

const colinus = { id: "colinus", name: "Colinus", type: "npc" as const, roles: [], aliases: [], visibility: "player_visible" as const, gm_summary: "Colinus murdered Reson.", player_summary: "A hunter and councilmember." };
const xancrown = { id: "xancrown", name: "Xancrown", type: "deity" as const, roles: ["enemy"] as const, aliases: ["The Plague Lord"], visibility: "dm_only" as const, gm_summary: "The secret villain.", player_summary: null };

describe("central campaign view filtering", () => {
  it("uses typed modes, defaults to DM, and preserves Player mode in links", () => {
    expect(campaignViewMode(undefined)).toBe("dm");
    expect(campaignViewMode("player")).toBe("player");
    expect(campaignHref("/campaigns/c/entities/e", "player")).toBe("/campaigns/c/entities/e?view=player");
  });

  it("filters entities and never falls back from a missing Player summary", () => {
    expect(visibleEntities([colinus, xancrown], "dm")).toHaveLength(2);
    expect(visibleEntities([colinus, xancrown], "player")).toEqual([colinus]);
    expect(visibleSummary(colinus, "dm")).toContain("murdered");
    expect(visibleSummary(colinus, "player")).toBe("A hunter and councilmember.");
    expect(visibleSummary(xancrown, "player")).toBe("");
  });

  it("makes hidden names and aliases unsearchable and hidden enemies uncounted", () => {
    const playerEntities = visibleEntities([colinus, xancrown], "player");
    expect(filterEntitiesBySearchTerm(playerEntities, "Xancrown")).toEqual([]);
    expect(filterEntitiesBySearchTerm(playerEntities, "Plague Lord")).toEqual([]);
    expect(playerEntities.filter((entity) => (entity.roles as readonly string[]).includes("enemy"))).toHaveLength(0);
  });

  it("omits DM facts and visible facts that structurally mention a hidden entity", () => {
    const facts = [
      { visibility: "player_visible" as const, content: "Village Councilmember", structured_value: null },
      { visibility: "dm_only" as const, content: "Murdered Reson", structured_value: null },
      { visibility: "player_visible" as const, content: "Serves Xancrown", structured_value: { target: "xancrown" } },
    ];
    expect(visibleFacts(facts, [colinus, xancrown], "player").map((fact) => fact.content)).toEqual(["Village Councilmember"]);
    expect(visibleFacts(facts, [colinus, xancrown], "dm")).toHaveLength(3);
  });

  it("filters a normalized relationship once when either endpoint is hidden", () => {
    const relationships = [
      { id: "public", visibility: "player_visible" as const, source_entity_id: "colinus", target_entity_id: "colinus" },
      { id: "leak", visibility: "player_visible" as const, source_entity_id: "colinus", target_entity_id: "xancrown" },
      { id: "secret", visibility: "dm_only" as const, source_entity_id: "xancrown", target_entity_id: "colinus" },
    ];
    expect(visibleRelationships(relationships, [colinus, xancrown], "player").map((relationship) => relationship.id)).toEqual(["public"]);
    expect(visibleRelationships(relationships, [colinus, xancrown], "dm")).toHaveLength(3);
  });

  it("makes visible locations beyond hidden ancestors unparented without synthesizing containment", () => {
    const kingdom = { id: "kingdom", name: "Kingdom", type: "location" as const, roles: [], aliases: [], visibility: "player_visible" as const };
    const valley = { id: "valley", name: "Secret Valley", type: "location" as const, roles: [], aliases: [], visibility: "dm_only" as const };
    const shrine = { id: "shrine", name: "Ancient Shrine", type: "location" as const, roles: [], aliases: [], visibility: "player_visible" as const };
    const relationships = [
      { id: "valley-in-kingdom", visibility: "player_visible" as const, source_entity_id: "valley", target_entity_id: "kingdom", relationship_type: "located in", confidence: 1 },
      { id: "shrine-in-valley", visibility: "player_visible" as const, source_entity_id: "shrine", target_entity_id: "valley", relationship_type: "located in", confidence: 1 },
    ];
    const locations = visibleEntities([kingdom, valley, shrine], "player");
    const hierarchy = buildLocationHierarchy(locations, visibleRelationships(relationships, [kingdom, valley, shrine], "player").map((relationship) => ({ ...relationship, sourceId: relationship.source_entity_id, targetId: relationship.target_entity_id, relationshipType: relationship.relationship_type })));
    expect(hierarchy.getRoots().map((location) => location.name)).toEqual(["Ancient Shrine", "Kingdom"]);
    expect(hierarchy.getParent("shrine")).toBeUndefined();
    expect(hierarchy.getPath("shrine").map((location) => location.name)).toEqual(["Ancient Shrine"]);
  });
});
