import { regressionCachedChunks, regressionReconciliationDecision } from "@/fixtures/regression-cache";
import { buildEvaluationMetrics } from "@/lib/evaluation/metrics";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { aggregateCachedChunks } from "@/lib/processing/replay-cache";
import { relationshipsForEntity } from "@/lib/relationships/view";
import { describe, expect, it } from "vitest";

function replayFixture() {
  const aggregate = aggregateCachedChunks(regressionCachedChunks);
  return { aggregate, graph: buildCanonicalGraph(aggregate, regressionReconciliationDecision(aggregate)) };
}

describe("Milestone 7 deterministic regression and replay fixture", () => {
  it("replays cached candidates through reconciliation and canonical graph construction without model calls", () => {
    const { aggregate, graph } = replayFixture();
    expect(aggregate.entities).toHaveLength(19);
    expect(graph.entities).toHaveLength(15);
    expect(graph.relationships).toHaveLength(5);
  });

  it("locks in the confirmed cross-type Demonplague findings and the confirmed non-duplicate pair", () => {
    const { graph } = replayFixture();
    const entity = (name: string) => graph.entities.filter((candidate) => candidate.name === name);
    expect(entity("Cay Naja")).toHaveLength(1);
    expect(entity("Xancrown")[0]).toMatchObject({ type: "deity", roles: ["enemy"] });
    expect(entity("Demonplague")[0]).toMatchObject({ type: "event" });
    expect(entity("Demonplague")[0].aliases).toContain("The Demonplague");
    expect(entity("Gardong Marhold")[0]).toMatchObject({ type: "location" });
    expect(entity("Jeanas Clocker")).toHaveLength(1);
    expect(entity("Jesper Clocker")).toHaveLength(1);
  });

  it("preserves one entity per deity, enemy NPC, and enemy faction without changing their category", () => {
    const { graph } = replayFixture();
    expect(graph.entities.find((entity) => entity.name === "Xancrown")).toMatchObject({ type: "deity", roles: ["enemy"] });
    expect(graph.entities.find((entity) => entity.name === "Merriath")).toMatchObject({ type: "npc", roles: ["enemy"] });
    expect(graph.entities.find((entity) => entity.name === "Cult of Chaos")).toMatchObject({ type: "faction", roles: ["enemy"] });
    expect(graph.entities.filter((entity) => entity.roles.includes("enemy")).map((entity) => entity.type)).toEqual(["deity", "npc", "faction"]);
  });

  it("normalizes the Colinus and Kylar inverse relationship once while retaining both source pages", () => {
    const { graph } = replayFixture();
    const colinus = graph.entities.find((entity) => entity.name === "Colinus Birthwitch")!;
    const kylar = graph.entities.find((entity) => entity.name === "Kylar Birthwitch")!;
    const relationship = graph.relationships.find((candidate) => candidate.relationshipType === "uncle of")!;
    expect(relationship.sources.map((source) => source.page_number)).toEqual([6, 7]);
    const rows = relationshipsForEntity([{ id: relationship.key, source_entity_id: relationship.sourceEntityKey, target_entity_id: relationship.targetEntityKey, relationship_type: relationship.relationshipType, description: relationship.description, confidence: relationship.confidence }], kylar.key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relatedEntityId: colinus.key, displayLabel: "nephew of" });
  });

  it("retains the full location chain and source-backed normalized containment after replay", () => {
    const { graph } = replayFixture();
    const hierarchy = buildLocationHierarchy(
      graph.entities.filter((entity) => entity.type === "location").map((entity) => ({ id: entity.key, name: entity.name })),
      graph.relationships.map((relationship) => ({ id: relationship.key, sourceId: relationship.sourceEntityKey, targetId: relationship.targetEntityKey, relationshipType: relationship.relationshipType, confidence: relationship.confidence })),
    );
    const altar = graph.entities.find((entity) => entity.name === "Altar")!;
    expect(hierarchy.getPath(altar.key).map((location) => location.name)).toEqual(["Kingdom", "Village", "Tavern", "Basement", "Altar"]);
    expect(hierarchy.selectedRelationshipIds.size).toBe(4);
    expect(hierarchy.getRoots().map((location) => location.name)).toEqual(["Gardong Marhold", "Kingdom"]);
  });

  it("reports structured offline evaluation metrics for future benchmark comparison", () => {
    const { aggregate, graph } = replayFixture();
    expect(buildEvaluationMetrics(aggregate, graph)).toMatchObject({
      candidateEntityCount: 19,
      canonicalEntityCount: 15,
      duplicateCandidatesResolved: 4,
      candidateRelationshipCount: 6,
      relationshipsCreated: 5,
      relationshipSourceEvidenceCount: 6,
      hierarchyEdges: 4,
      roleCounts: { enemy: 3 },
    });
  });
});
