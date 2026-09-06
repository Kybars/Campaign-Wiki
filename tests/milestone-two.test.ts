import { describe, expect, it } from "vitest";
import { reconciliationDecisionSchema, type ReconciliationDecision, type SourceEvidence } from "@/lib/ai/schemas";
import { buildCanonicalGraph } from "@/lib/graph/build";
import {
  buildCrossTypeReconciliationCandidates,
  buildDeterministicGroups,
} from "@/lib/graph/reconcile";
import type {
  CandidateAggregate,
  DeterministicGroup,
  GlobalCandidateEntity,
  GlobalCandidateRelationship,
} from "@/lib/graph/types";
import { parseCachedReconciliation } from "@/lib/processing/replay-cache";

function entity(
  id: string,
  name: string,
  type: GlobalCandidateEntity["type"],
  options: { aliases?: string[]; page?: number; text?: string } = {},
): GlobalCandidateEntity {
  const [chunkId, temporaryId] = id.split(":");
  const page = options.page ?? 1;
  return {
    id,
    chunkId,
    temporaryId,
    name,
    type,
    roles: [],
    aliases: options.aliases ?? [],
    summary: options.text ?? `${name} is described in the campaign.`,
    sources: [{ page_number: page, supporting_text: options.text ?? `${name} is described in the campaign.` }],
  };
}

function relationship(
  id: string,
  sourceCandidateId: string,
  targetCandidateId: string,
  page: number,
): GlobalCandidateRelationship {
  return {
    id,
    chunkId: id.split(":")[0],
    sourceCandidateId,
    targetCandidateId,
    relationship_type: "opposes",
    description: "The entity opposes the heroes.",
    confidence: 0.95,
    sources: [{ page_number: page, supporting_text: `On page ${page}, the entity opposes the heroes.` }],
  };
}

function decision(
  groups: DeterministicGroup[],
  name: string,
  type: GlobalCandidateEntity["type"],
  identityEvidence?: SourceEvidence[],
): ReconciliationDecision {
  return {
    canonical_entities: [{
      canonical_id: "canonical-merge",
      name,
      group_ids: groups.map((group) => group.id),
      type,
      roles: [],
      aliases: [],
      summary: `${name} is the reconciled entity.`,
      identity_evidence: identityEvidence ?? groups[0].candidates[0].sources,
    }],
  };
}

function graphForCrossType(
  entities: GlobalCandidateEntity[],
  name: string,
  type: GlobalCandidateEntity["type"],
) {
  const aggregate: CandidateAggregate = { entities, relationships: [] };
  const groups = buildDeterministicGroups(aggregate);
  return { groups, graph: buildCanonicalGraph(aggregate, decision(groups, name, type)) };
}

describe("Milestone 2 cross-type entity reconciliation", () => {
  it("still merges the same normalized name and type deterministically", () => {
    const aggregate: CandidateAggregate = {
      entities: [entity("c1:x", " Xancrown ", "npc"), entity("c2:x", "xancrown", "npc")],
      relationships: [],
    };
    expect(buildDeterministicGroups(aggregate)).toHaveLength(1);
    expect(buildCanonicalGraph(aggregate).entities).toHaveLength(1);
  });

  it("generates but does not automatically merge exact-name cross-type candidates", () => {
    const aggregate: CandidateAggregate = {
      entities: [entity("c1:x", "Xancrown", "npc"), entity("c2:x", "Xancrown", "other")],
      relationships: [],
    };
    const groups = buildDeterministicGroups(aggregate);
    expect(groups).toHaveLength(2);
    expect(buildCrossTypeReconciliationCandidates(groups)).toEqual([
      { normalizedIdentity: "xancrown", groupIds: groups.map((group) => group.id) },
    ]);
    expect(buildCanonicalGraph(aggregate).entities).toHaveLength(2);
    expect(buildCanonicalGraph(aggregate, decision(groups, "Xancrown", "deity", [])).entities).toHaveLength(2);
    expect(buildCanonicalGraph(aggregate, decision(groups, "Xancrown", "deity")).entities).toHaveLength(1);
  });

  it("reconciles Xancrown npc and other into one canonical entity", () => {
    const { graph } = graphForCrossType(
      [entity("c1:x", "Xancrown", "npc"), entity("c2:x", "Xancrown", "other")],
      "Xancrown",
      "deity",
    );
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]).toMatchObject({ name: "Xancrown", type: "deity" });
  });

  it("reconciles Cay Naja npc and other into one canonical entity", () => {
    const { graph } = graphForCrossType(
      [entity("c1:cay", "Cay Naja", "npc"), entity("c2:cay", "Cay Naja", "other")],
      "Cay Naja",
      "npc",
    );
    expect(graph.entities).toHaveLength(1);
    expect(new Set(graph.entities[0].candidateIds)).toEqual(new Set(["c1:cay", "c2:cay"]));
  });

  it("selects location as the canonical type for Gardong Marhold", () => {
    const placeEvidence = "Gardong Marhold is a settlement beside the frozen river.";
    const { graph } = graphForCrossType(
      [
        entity("c1:gardong", "Gardong Marhold", "npc", { text: "Gardong Marhold appears in the chapter." }),
        entity("c2:gardong", "Gardong Marhold", "location", { page: 2, text: placeEvidence }),
      ],
      "Gardong Marhold",
      "location",
    );
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0].type).toBe("location");
  });

  it("reconciles Demonplague and The Demonplague through an explicit alias", () => {
    const aggregate: CandidateAggregate = {
      entities: [
        entity("c1:plague", "Demonplague", "event", { aliases: ["The Demonplague"] }),
        entity("c2:plague", "The Demonplague", "other"),
      ],
      relationships: [],
    };
    const groups = buildDeterministicGroups(aggregate);
    expect(buildCrossTypeReconciliationCandidates(groups)).toHaveLength(1);
    const graph = buildCanonicalGraph(aggregate, decision(groups, "The Demonplague", "event"));
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0].aliases).toContain("Demonplague");
  });

  it("keeps Jeanas Clocker and Jesper Clocker separate on similarity alone", () => {
    const aggregate: CandidateAggregate = {
      entities: [
        entity("c1:jeanas", "Jeanas Clocker", "npc", { text: "Jeanas Clocker is Jesper's father." }),
        entity("c1:jesper", "Jesper Clocker", "npc", { text: "Jesper Clocker is Jeanas's son." }),
      ],
      relationships: [],
    };
    const groups = buildDeterministicGroups(aggregate);
    expect(buildCrossTypeReconciliationCandidates(groups)).toHaveLength(0);
    expect(buildCanonicalGraph(aggregate).entities).toHaveLength(2);
    const unsafeDecision = decision(groups, "Clocker", "npc", []);
    expect(buildCanonicalGraph(aggregate, unsafeDecision).entities).toHaveLength(2);
  });

  it("preserves aliases, sources, mappings, and relationships from all merged candidates", () => {
    const entities = [
      entity("c1:x", "Xancrown", "npc", { aliases: ["The Plague Lord"], page: 3 }),
      entity("c2:x", "Xancrown", "other", { aliases: ["Lord Xancrown"], page: 9 }),
      entity("c1:heroes", "The Heroes", "faction", { page: 3 }),
    ];
    const relationships = [
      relationship("c1:r1", "c1:x", "c1:heroes", 3),
      relationship("c2:r2", "c2:x", "c1:heroes", 9),
    ];
    const aggregate: CandidateAggregate = { entities, relationships };
    const groups = buildDeterministicGroups(aggregate);
    const xancrownGroups = groups.filter((group) => group.candidates.some((candidate) => candidate.name === "Xancrown"));
    const heroesGroup = groups.find((group) => group.type === "faction")!;
    const merge = decision(xancrownGroups, "Xancrown", "deity");
    merge.canonical_entities.push({
      canonical_id: "heroes",
      name: "The Heroes",
      group_ids: [heroesGroup.id],
      type: "faction",
      roles: [],
      aliases: [],
      summary: "The campaign's heroes.",
      identity_evidence: [],
    });
    const graph = buildCanonicalGraph(aggregate, merge);
    const xancrown = graph.entities.find((candidate) => candidate.name === "Xancrown")!;
    expect(graph.entities).toHaveLength(2);
    expect(xancrown.aliases).toEqual(expect.arrayContaining(["The Plague Lord", "Lord Xancrown"]));
    expect(xancrown.sources.map((source) => source.page_number)).toEqual([3, 9]);
    expect(graph.candidateToCanonical.get("c1:x")).toBe(graph.candidateToCanonical.get("c2:x"));
    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0].sourceEntityKey).toBe(xancrown.key);
    expect(graph.relationships[0].sources.map((source) => source.page_number)).toEqual([3, 9]);
    expect(graph.relationships[0].candidateRelationshipIds).toEqual(["c1:r1", "c2:r2"]);
  });

  it("retains deity as a valid reconciliation-selected canonical type", () => {
    const { graph, groups } = graphForCrossType(
      [entity("c1:god", "Naja", "npc"), entity("c2:god", "Naja", "other")],
      "Naja",
      "deity",
    );
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0].type).toBe("deity");
    expect(reconciliationDecisionSchema.parse(decision(groups, "Naja", "deity")).canonical_entities[0].type).toBe("deity");
  });

  it("upgrades pre-Milestone 2 cached decisions when their type is unambiguous", () => {
    const aggregate: CandidateAggregate = {
      entities: [entity("c1:hanna", "Hanna Stone", "npc")],
      relationships: [],
    };
    const groups = buildDeterministicGroups(aggregate);
    expect(parseCachedReconciliation({
      canonical_entities: [{
        canonical_id: "hanna",
        name: "Hanna Stone",
        group_ids: [groups[0].id],
        aliases: [],
        summary: "An innkeeper.",
      }],
    }, groups)).toEqual({
      canonical_entities: [{
        canonical_id: "hanna",
        name: "Hanna Stone",
        group_ids: [groups[0].id],
        type: "npc",
        roles: [],
        aliases: [],
        summary: "An innkeeper.",
        identity_evidence: [],
      }],
    });
  });
});
