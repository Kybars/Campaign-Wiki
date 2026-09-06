import { describe, expect, it } from "vitest";
import type { CandidateAggregate, GlobalCandidateEntity, GlobalCandidateRelationship } from "@/lib/graph/types";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";

function entity(
  id: string,
  name: string,
  type: GlobalCandidateEntity["type"] = "npc",
  aliases: string[] = [],
  roles: GlobalCandidateEntity["roles"] = [],
): GlobalCandidateEntity {
  const [chunkId, temporaryId] = id.split(":");
  return { id, chunkId, temporaryId, name, type, roles, aliases, summary: `${name} summary`, sources: [{ page_number: 1, supporting_text: `${name} appears in the campaign.` }] };
}

function relationship(id: string, chunkId: string, sourceCandidateId: string, targetCandidateId: string, relationshipType = "owns"): GlobalCandidateRelationship {
  return {
    id,
    chunkId,
    sourceCandidateId,
    targetCandidateId,
    relationship_type: relationshipType,
    description: "Hanna Stone owns the Silver Stag Inn.",
    confidence: 0.9,
    sources: [{ page_number: 1, supporting_text: "Hanna Stone owns the Silver Stag Inn." }],
  };
}

describe("canonical graph", () => {
  it("merges exact normalized names and explicit aliases but not similar names", () => {
    const aggregate: CandidateAggregate = {
      entities: [
        entity("c1:e1", "Hanna Stone", "npc", ["H. Stone"]),
        entity("c2:e1", " hanna  stone "),
        entity("c3:e1", "H. Stone"),
        entity("c1:e2", "King Robert"),
        entity("c1:e3", "Prince Robert"),
      ],
      relationships: [],
    };
    const groups = buildDeterministicGroups(aggregate);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.candidates.some((candidate) => candidate.name === "Hanna Stone"))?.candidates).toHaveLength(3);
    const graph = buildCanonicalGraph(aggregate);
    expect(graph.entities.map((item) => item.name)).toEqual(expect.arrayContaining(["King Robert", "Prince Robert"]));
  });

  it("applies conservative AI merges and remaps endpoints to canonical IDs", () => {
    const aggregate: CandidateAggregate = {
      entities: [entity("c1:e1", "Ralekai"), entity("c2:e1", "Ralekai the Scientist"), entity("c1:e2", "Soul Stone", "item")],
      relationships: [relationship("r1", "c1", "c1:e1", "c1:e2", "needs")],
    };
    const groups = buildDeterministicGroups(aggregate);
    const ralekaiGroups = groups.filter((group) => group.type === "npc");
    const soulGroup = groups.find((group) => group.type === "item")!;
    const graph = buildCanonicalGraph(aggregate, {
      canonical_entities: [
        { canonical_id: "c1", name: "Ralekai", group_ids: ralekaiGroups.map((group) => group.id), roles: [], aliases: ["Ralekai the Scientist"], summary: "An undead scientist." },
        { canonical_id: "c2", name: "Soul Stone", group_ids: [soulGroup.id], roles: [], aliases: [], summary: "An important stone." },
      ],
    });
    expect(graph.entities).toHaveLength(2);
    expect(graph.candidateToCanonical.get("c1:e1")).toBe(graph.candidateToCanonical.get("c2:e1"));
    expect(graph.relationships[0].sourceEntityKey).toBe(graph.candidateToCanonical.get("c1:e1"));
    expect(graph.relationships[0].targetEntityKey).toBe(graph.candidateToCanonical.get("c1:e2"));
  });

  it("deduplicates repeated relationships and consolidates evidence", () => {
    const aggregate: CandidateAggregate = {
      entities: [entity("c1:e1", "Hanna Stone"), entity("c1:e2", "Silver Stag Inn", "location"), entity("c2:e1", "Hanna Stone"), entity("c2:e2", "Silver Stag Inn", "location")],
      relationships: [
        relationship("r1", "c1", "c1:e1", "c1:e2"),
        { ...relationship("r2", "c2", "c2:e1", "c2:e2"), sources: [{ page_number: 6, supporting_text: "Hanna still owns the Silver Stag Inn." }] },
      ],
    };
    const graph = buildCanonicalGraph(aggregate);
    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0].sources).toHaveLength(2);
    expect(graph.relationships[0].candidateRelationshipIds).toEqual(["r1", "r2"]);
  });

  it("discards a relationship when reconciliation makes it a self-edge", () => {
    const aggregate: CandidateAggregate = {
      entities: [entity("c1:e1", "Hanna Stone", "npc", ["H. Stone"]), entity("c1:e2", "H. Stone")],
      relationships: [relationship("r1", "c1", "c1:e1", "c1:e2")],
    };
    const graph = buildCanonicalGraph(aggregate);
    expect(graph.relationships).toHaveLength(0);
    expect(graph.discardedRelationships[0].reason).toContain("same entity");
  });
});
