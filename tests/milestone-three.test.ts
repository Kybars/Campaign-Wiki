import { describe, expect, it } from "vitest";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { buildDeterministicGroups } from "@/lib/graph/reconcile";
import type { CandidateAggregate, GlobalCandidateEntity, GlobalCandidateRelationship } from "@/lib/graph/types";
import { normalizeRelationshipFact, relationshipSemanticKey } from "@/lib/relationships/normalize";
import { relationshipsForEntity } from "@/lib/relationships/view";

function entity(id: string, name: string, type: GlobalCandidateEntity["type"] = "npc"): GlobalCandidateEntity {
  const [chunkId, temporaryId] = id.split(":");
  return {
    id,
    chunkId,
    temporaryId,
    name,
    type,
    roles: [],
    aliases: [],
    summary: `${name} summary`,
    sources: [{ page_number: 1, supporting_text: `${name} appears in the campaign.` }],
  };
}

function relationship(
  id: string,
  sourceCandidateId: string,
  targetCandidateId: string,
  relationshipType: string,
  page = 1,
  description = `${sourceCandidateId} ${relationshipType} ${targetCandidateId}.`,
): GlobalCandidateRelationship {
  return {
    id,
    chunkId: id.split(":")[0],
    sourceCandidateId,
    targetCandidateId,
    relationship_type: relationshipType,
    description,
    confidence: 0.9,
    sources: [{ page_number: page, supporting_text: `Evidence on page ${page} for ${description}` }],
  };
}

function aggregate(relationships: GlobalCandidateRelationship[]): CandidateAggregate {
  return {
    entities: [entity("c1:a", "A"), entity("c1:b", "B")],
    relationships,
  };
}

describe("Milestone 3 relationship normalization", () => {
  it.each([
    ["parent_of", "child_of"],
    ["uncle_of", "nephew_of"],
    ["uncle_of", "niece_of"],
    ["aunt_of", "nephew_of"],
    ["aunt_of", "niece_of"],
    ["owns", "owned_by"],
    ["member_of", "has_member"],
    ["located_in", "contains"],
    ["serves_on", "has_member"],
  ])("keeps %s and its possible %s inverse separate before reconciliation", (directType, inverseType) => {
    const direct = normalizeRelationshipFact("a", "b", directType);
    const inverse = normalizeRelationshipFact("b", "a", inverseType);
    expect(relationshipSemanticKey(direct)).not.toBe(relationshipSemanticKey(inverse));
  });

  it("leaves a direct freeform relationship unchanged", () => {
    const graph = buildCanonicalGraph(aggregate([relationship("c1:r1", "c1:a", "c1:b", "blackmails")]));
    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0]).toMatchObject({ relationshipType: "blackmails" });
  });

  it("does not lexically collapse a possible inverse pair", () => {
    const graph = buildCanonicalGraph(aggregate([
      relationship("c1:r1", "c1:a", "c1:b", "parent_of", 4),
      relationship("c1:r2", "c1:b", "c1:a", "child_of", 7),
    ]));
    expect(graph.relationships).toHaveLength(2);
  });

  it("preserves endpoints when only a possible inverse form is present", () => {
    const graph = buildCanonicalGraph(aggregate([
      relationship("c1:r1", "c1:b", "c1:a", "child of"),
    ]));
    expect(graph.relationships[0]).toMatchObject({
      sourceEntityKey: graph.candidateToCanonical.get("c1:b"),
      targetEntityKey: graph.candidateToCanonical.get("c1:a"),
      relationshipType: "child of",
    });
  });

  it("keeps source evidence on distinct unreconciled forms", () => {
    const shortDescription = "A owns B.";
    const richDescription = "B is owned by A under the original charter.";
    const graph = buildCanonicalGraph(aggregate([
      relationship("c1:r1", "c1:a", "c1:b", "owns", 12, shortDescription),
      relationship("c1:r2", "c1:b", "c1:a", "owned_by", 20, richDescription),
    ]));
    expect(graph.relationships).toHaveLength(2);
    expect(graph.relationships.flatMap((item) => item.sources.map((source) => source.page_number)).sort((a, b) => a - b)).toEqual([12, 20]);
  });

  it("keeps the canonical forward label from the target entity perspective", () => {
    const row = {
      id: "r1",
      source_entity_id: "parent",
      target_entity_id: "child",
      relationship_type: "parent of",
      description: "The parent raised the child.",
      confidence: 0.9,
    };
    expect(relationshipsForEntity([row], "child")[0]).toMatchObject({
      relatedEntityId: "parent",
      displayLabel: "parent of",
      outgoing: false,
    });
  });

  it("does not guess that legacy persisted opposite phrases are equivalent", () => {
    const rows = [
      { id: "r1", source_entity_id: "a", target_entity_id: "b", relationship_type: "parent_of", description: "A is B's parent.", confidence: 0.8 },
      { id: "r2", source_entity_id: "b", target_entity_id: "a", relationship_type: "child_of", description: "B is A's child.", confidence: 0.9 },
    ];
    const viewed = relationshipsForEntity(rows, "a");
    expect(viewed).toHaveLength(2);
  });

  it("keeps uncle/nephew instances separate without a reconciliation decision", () => {
    const graph = buildCanonicalGraph({
      entities: [entity("c1:colinus", "Colinus Birthwitch"), entity("c1:kylar", "Kylar Birthwitch")],
      relationships: [
        relationship("c1:r1", "c1:colinus", "c1:kylar", "uncle_of", 12),
        relationship("c1:r2", "c1:kylar", "c1:colinus", "nephew_of", 20),
      ],
    });
    expect(graph.relationships).toHaveLength(2);
  });

  it("keeps genuinely different relationship types between the same entities", () => {
    const graph = buildCanonicalGraph(aggregate([
      relationship("c1:r1", "c1:a", "c1:b", "owns"),
      relationship("c1:r2", "c1:a", "c1:b", "blackmails"),
    ]));
    expect(graph.relationships.map((item) => item.relationshipType)).toEqual(["owns", "blackmails"]);
  });

  it("keeps reverse freeform relationships distinct and uses generic reverse rendering", () => {
    const graph = buildCanonicalGraph(aggregate([
      relationship("c1:r1", "c1:a", "c1:b", "mentors"),
      relationship("c1:r2", "c1:b", "c1:a", "admires"),
    ]));
    expect(graph.relationships).toHaveLength(2);
    const row = { id: "r1", source_entity_id: "a", target_entity_id: "b", relationship_type: "mentors", description: "A mentors B.", confidence: 0.9 };
    expect(relationshipsForEntity([row], "b")[0].displayLabel).toBe("mentors");
  });

  it("normalizes after cross-type candidate-to-canonical remapping", () => {
    const input: CandidateAggregate = {
      entities: [
        entity("c1:x", "Xancrown", "npc"),
        entity("c2:x", "Xancrown", "other"),
        entity("c1:cult", "Cult of Ash", "faction"),
      ],
      relationships: [
        relationship("c1:r1", "c1:x", "c1:cult", "member_of", 3),
        relationship("c2:r2", "c1:cult", "c2:x", "has_member", 9),
      ],
    };
    const groups = buildDeterministicGroups(input);
    const xGroups = groups.filter((group) => group.candidates.some((candidate) => candidate.name === "Xancrown"));
    const cultGroup = groups.find((group) => group.type === "faction")!;
    const graph = buildCanonicalGraph(input, {
      canonical_entities: [
        { canonical_id: "x", name: "Xancrown", group_ids: xGroups.map((group) => group.id), type: "deity", roles: [], aliases: [], summary: "A hostile deity.", identity_evidence: xGroups.flatMap((group) => group.candidates.flatMap((candidate) => candidate.sources)) },
        { canonical_id: "cult", name: "Cult of Ash", group_ids: [cultGroup.id], type: "faction", roles: [], aliases: [], summary: "A cult.", identity_evidence: cultGroup.candidates.flatMap((candidate) => candidate.sources) },
      ],
    });
    expect(graph.relationships).toHaveLength(2);
    expect(graph.relationships.flatMap((item) => item.sources.map((source) => source.page_number)).sort((a, b) => a - b)).toEqual([3, 9]);
  });

  it("keeps located_in and contains distinct until semantic reconciliation", () => {
    const graph = buildCanonicalGraph(aggregate([
      relationship("c1:r1", "c1:a", "c1:b", "located_in"),
      relationship("c1:r2", "c1:b", "c1:a", "contains"),
    ]));
    expect(graph.relationships).toHaveLength(2);
  });
});
