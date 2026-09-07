import { describe, expect, it } from "vitest";
import { filterEntitiesBySearchTerm } from "@/lib/entities";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import type { CandidateAggregate, GlobalCandidateEntity, GlobalCandidateRelationship } from "@/lib/graph/types";
import { buildLocationHierarchy, type HierarchyRelationship, type LocationRecord } from "@/lib/locations/hierarchy";

function locations(...names: string[]): LocationRecord[] {
  return names.map((name) => ({ id: name.toLocaleLowerCase("en-US").replaceAll(" ", "-"), name }));
}

function edge(
  id: string,
  childId: string,
  parentId: string,
  relationshipType = "located_in",
  confidence = 0.95,
): HierarchyRelationship {
  return { id, sourceId: childId, targetId: parentId, relationshipType, confidence };
}

function candidateEntity(id: string, name: string, type: GlobalCandidateEntity["type"] = "location"): GlobalCandidateEntity {
  const [chunkId, temporaryId] = id.split(":");
  return {
    id,
    chunkId,
    temporaryId,
    name,
    type,
    roles: [],
    aliases: [],
    summary: `${name} is described in the campaign.`,
    sources: [{ page_number: 1, supporting_text: `${name} is described in the campaign.` }],
  };
}

function candidateRelationship(
  id: string,
  sourceCandidateId: string,
  targetCandidateId: string,
  relationshipType = "located_in",
  page = 1,
  confidence = 0.95,
): GlobalCandidateRelationship {
  return {
    id,
    chunkId: id.split(":")[0],
    sourceCandidateId,
    targetCandidateId,
    relationship_type: relationshipType,
    description: `${sourceCandidateId} ${relationshipType} ${targetCandidateId}.`,
    confidence,
    sources: [{ page_number: page, supporting_text: `Page ${page} explicitly supports this physical containment.` }],
  };
}

describe("Milestone 4 recursive location hierarchy", () => {
  it("builds the canonical chain with ordered traversal, roots, breadcrumbs, and a nested tree", () => {
    const records = locations("Kingdom", "Village", "Tavern", "Basement", "Altar");
    const hierarchy = buildLocationHierarchy(records, [
      edge("r1", "village", "kingdom"),
      edge("r2", "tavern", "village"),
      edge("r3", "basement", "tavern"),
      edge("r4", "altar", "basement"),
    ]);

    expect(hierarchy.getRoots().map((location) => location.name)).toEqual(["Kingdom"]);
    expect(hierarchy.getParent("village")?.name).toBe("Kingdom");
    expect(hierarchy.getParent("tavern")?.name).toBe("Village");
    expect(hierarchy.getParent("basement")?.name).toBe("Tavern");
    expect(hierarchy.getParent("altar")?.name).toBe("Basement");
    expect(hierarchy.getChildren("village").map((location) => location.name)).toEqual(["Tavern"]);
    expect(hierarchy.getAncestors("altar").map((location) => location.name)).toEqual(["Kingdom", "Village", "Tavern", "Basement"]);
    expect(hierarchy.getDescendants("kingdom").map((location) => location.name)).toEqual(["Village", "Tavern", "Basement", "Altar"]);
    expect(hierarchy.getPath("altar").map((location) => location.name)).toEqual(["Kingdom", "Village", "Tavern", "Basement", "Altar"]);
    expect(hierarchy.buildTree()[0].children[0].children[0].children[0].children[0].location.name).toBe("Altar");
  });

  it("has no hardcoded hierarchy depth", () => {
    const records = Array.from({ length: 150 }, (_, index) => ({ id: `level-${index}`, name: `Level ${index}` }));
    const relationships = records.slice(1).map((location, index) => edge(`r-${index}`, location.id, records[index].id));
    const hierarchy = buildLocationHierarchy(records, relationships);
    expect(hierarchy.getAncestors("level-149")).toHaveLength(149);
    expect(hierarchy.getDescendants("level-0")).toHaveLength(149);
    expect(hierarchy.getPath("level-149")).toHaveLength(150);
  });

  it("keeps orphan locations valid and supports multiple unrelated roots", () => {
    const records = locations("North", "South", "Lost Cellar");
    const hierarchy = buildLocationHierarchy(records, [edge("r1", "lost-cellar", "missing-place")]);
    expect(hierarchy.getParent("lost-cellar")).toBeUndefined();
    expect(hierarchy.getOrphans().map((location) => location.name)).toEqual(["Lost Cellar"]);
    expect(hierarchy.getRoots().map((location) => location.name)).toEqual(["Lost Cellar", "North", "South"]);
    expect(hierarchy.buildTree()).toHaveLength(3);
  });

  it("normalizes located_in and contains into one canonical containment fact with all sources", () => {
    const graph = buildCanonicalGraph({
      entities: [
        candidateEntity("c1:tavern", "Tavern"),
        candidateEntity("c1:village", "Village"),
        candidateEntity("c2:tavern", "Tavern"),
        candidateEntity("c2:village", "Village"),
      ],
      relationships: [
        candidateRelationship("c1:r1", "c1:tavern", "c1:village", "located_in", 4),
        candidateRelationship("c2:r2", "c2:village", "c2:tavern", "contains", 9),
      ],
    });
    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0].relationshipType).toBe("located in");
    expect(graph.relationships[0].sources.map((source) => source.page_number)).toEqual([4, 9]);
  });

  it("preserves containment after cross-type canonical entity remapping", () => {
    const aggregate: CandidateAggregate = {
      entities: [
        candidateEntity("c1:tavern", "Jorney's Tavern", "location"),
        candidateEntity("c2:tavern", "Jorney's Tavern", "other"),
        candidateEntity("c1:village", "Tomar's Crossing", "location"),
      ],
      relationships: [
        candidateRelationship("c1:r1", "c1:tavern", "c1:village", "located_in", 5),
        candidateRelationship("c2:r2", "c1:village", "c2:tavern", "contains", 8),
      ],
    };
    const groups = buildDeterministicGroups(aggregate);
    const tavernGroups = groups.filter((group) => group.candidates.some((candidate) => candidate.name === "Jorney's Tavern"));
    const villageGroup = groups.find((group) => group.candidates.some((candidate) => candidate.name === "Tomar's Crossing"))!;
    const graph = buildCanonicalGraph(aggregate, {
      canonical_entities: [
        {
          canonical_id: "tavern",
          name: "Jorney's Tavern",
          group_ids: tavernGroups.map((group) => group.id),
          type: "location",
          roles: [],
          aliases: [],
          summary: "A tavern in Tomar's Crossing.",
          identity_evidence: tavernGroups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.sources)),
        },
        {
          canonical_id: "village",
          name: "Tomar's Crossing",
          group_ids: [villageGroup.id],
          type: "location",
          roles: [],
          aliases: [],
          summary: "A village.",
          identity_evidence: villageGroup.candidates.flatMap((candidate) => candidate.sources),
        },
      ],
    });
    expect(graph.entities).toHaveLength(2);
    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0].sources.map((source) => source.page_number)).toEqual([5, 8]);
  });

  it("deduplicates children and records duplicate containment edges", () => {
    const records = locations("Village", "Tavern");
    const hierarchy = buildLocationHierarchy(records, [
      edge("r1", "tavern", "village", "located_in", 0.9),
      edge("r2", "village", "tavern", "contains", 0.8),
    ]);
    expect(hierarchy.getChildren("village").map((location) => location.name)).toEqual(["Tavern"]);
    expect(hierarchy.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ relationshipId: "r2", code: "duplicate_parent" })]));
  });

  it("detects a cycle and keeps every traversal finite", () => {
    const records = locations("A", "B", "C");
    const hierarchy = buildLocationHierarchy(records, [
      edge("r1", "a", "b"),
      edge("r2", "b", "c"),
      edge("r3", "c", "a"),
    ]);
    expect(hierarchy.diagnostics.some((item) => item.code === "cycle")).toBe(true);
    expect(hierarchy.selectedRelationshipIds.size).toBe(2);
    expect(hierarchy.getDescendants("c")).toHaveLength(2);
    expect(hierarchy.getPath("a")).toHaveLength(3);
  });

  it("removes a cyclic containment edge during canonical graph construction", () => {
    const graph = buildCanonicalGraph({
      entities: [candidateEntity("c1:a", "A"), candidateEntity("c1:b", "B"), candidateEntity("c1:c", "C")],
      relationships: [
        candidateRelationship("c1:r1", "c1:a", "c1:b"),
        candidateRelationship("c1:r2", "c1:b", "c1:c"),
        candidateRelationship("c1:r3", "c1:c", "c1:a"),
      ],
    });
    expect(graph.relationships).toHaveLength(2);
    expect(graph.locationHierarchyDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "cycle" })]));
  });

  it("rejects self-containment", () => {
    const hierarchy = buildLocationHierarchy(locations("A"), [edge("r1", "a", "a")]);
    expect(hierarchy.selectedRelationshipIds.size).toBe(0);
    expect(hierarchy.diagnostics[0]).toMatchObject({ code: "self_containment", childId: "a", parentId: "a" });
  });

  it("does not turn near or owned_by relationships into hierarchy", () => {
    const records = locations("Village", "Tavern");
    const hierarchy = buildLocationHierarchy(records, [
      edge("r1", "tavern", "village", "near"),
      edge("r2", "tavern", "village", "owned_by"),
    ]);
    expect(hierarchy.getParent("tavern")).toBeUndefined();
    expect(hierarchy.consideredRelationshipIds.size).toBe(0);
  });

  it("chooses a supported more-specific parent over a broader container", () => {
    const records = locations("Kingdom", "Village", "Tavern");
    const hierarchy = buildLocationHierarchy(records, [
      edge("r1", "village", "kingdom", "located_in", 0.9),
      edge("r2", "tavern", "village", "located_in", 0.8),
      edge("r3", "tavern", "kingdom", "located_in", 0.95),
    ]);
    expect(hierarchy.getParent("tavern")?.name).toBe("Village");
    expect(hierarchy.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ relationshipId: "r3", code: "less_specific_parent" })]));
  });

  it("persists only the more-specific canonical parent", () => {
    const graph = buildCanonicalGraph({
      entities: [
        candidateEntity("c1:kingdom", "Kingdom"),
        candidateEntity("c1:village", "Village"),
        candidateEntity("c1:tavern", "Tavern"),
      ],
      relationships: [
        candidateRelationship("c1:r1", "c1:village", "c1:kingdom", "located_in", 1, 0.9),
        candidateRelationship("c1:r2", "c1:tavern", "c1:village", "located_in", 2, 0.8),
        candidateRelationship("c1:r3", "c1:tavern", "c1:kingdom", "located_in", 3, 0.95),
      ],
    });
    const tavernKey = graph.candidateToCanonical.get("c1:tavern");
    const tavernParents = graph.relationships.filter((relationship) => relationship.sourceEntityKey === tavernKey);
    expect(tavernParents).toHaveLength(1);
    expect(graph.entities.find((entity) => entity.key === tavernParents[0].targetEntityKey)?.name).toBe("Village");
  });

  it("leaves unrelated parent candidates unresolved when support is ambiguous", () => {
    const records = locations("North", "South", "Tavern");
    const hierarchy = buildLocationHierarchy(records, [
      edge("r1", "tavern", "north", "located_in", 0.85),
      edge("r2", "tavern", "south", "located_in", 0.8),
    ]);
    expect(hierarchy.getParent("tavern")).toBeUndefined();
    expect(hierarchy.getOrphans().map((location) => location.name)).toEqual(["Tavern"]);
    expect(hierarchy.diagnostics.filter((item) => item.code === "ambiguous_parent")).toHaveLength(2);
  });

  it("leaves a low-confidence parent unresolved", () => {
    const hierarchy = buildLocationHierarchy(locations("Village", "Tavern"), [
      edge("r1", "tavern", "village", "located_in", 0.6),
    ]);
    expect(hierarchy.getParent("tavern")).toBeUndefined();
    expect(hierarchy.getOrphans().map((location) => location.name)).toEqual(["Tavern"]);
    expect(hierarchy.diagnostics[0]).toMatchObject({ code: "low_confidence" });
  });

  it("keeps similarly named contained locations as separate identities", () => {
    const graph = buildCanonicalGraph({
      entities: [
        candidateEntity("c1:safeharbor", "Safeharbor"),
        candidateEntity("c1:camp", "Safeharbor Refugee Camp"),
      ],
      relationships: [candidateRelationship("c1:r1", "c1:camp", "c1:safeharbor")],
    });
    expect(graph.entities.map((entity) => entity.name)).toEqual(["Safeharbor", "Safeharbor Refugee Camp"]);
    expect(graph.relationships).toHaveLength(1);
  });

  it("preserves ordinary relationships alongside containment", () => {
    const graph = buildCanonicalGraph({
      entities: [
        candidateEntity("c1:village", "Village"),
        candidateEntity("c1:tavern", "Tavern"),
        candidateEntity("c1:owner", "Jorney Yovurn", "npc"),
      ],
      relationships: [
        candidateRelationship("c1:r1", "c1:tavern", "c1:village", "located_in"),
        candidateRelationship("c1:r2", "c1:tavern", "c1:owner", "owned_by"),
      ],
    });
    expect(graph.relationships.map((relationship) => relationship.relationshipType)).toEqual(["located in", "owns"]);
  });

  it("keeps deeply nested locations directly searchable and addressable", () => {
    const records = Array.from({ length: 40 }, (_, index) => ({ id: `place-${index}`, name: `Place ${index}`, aliases: [] as string[] }));
    const hierarchy = buildLocationHierarchy(
      records,
      records.slice(1).map((location, index) => edge(`r-${index}`, location.id, records[index].id)),
    );
    const results = filterEntitiesBySearchTerm(records, "Place 39");
    expect(results.map((location) => location.id)).toEqual(["place-39"]);
    expect(hierarchy.getPath(results[0].id)).toHaveLength(40);
  });
});
