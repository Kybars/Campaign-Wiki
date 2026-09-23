import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CandidateRelationship, ValidatedExtractionInventoryOutput } from "@/lib/ai/schemas";
import { normalizeName } from "@/lib/graph/normalize";
import { canonicalizeRelationshipForScoring, classifyRelationshipScoringMatch, relationshipsMatchForScoring, scoreWotbsRelationships, type WotbsGoldReference } from "../scripts/wotbs-stage1";

const matches = (
  actual: [string, string, string],
  expected: [string, string, string],
) => relationshipsMatchForScoring(
  { sourceId: actual[0], relationshipType: actual[1], targetId: actual[2] },
  { sourceId: expected[0], relationshipType: expected[1], targetId: expected[2] },
);

describe("canonical graph relationship scoring", () => {
  it.each([
    [["vault", "contains", "relic"], ["relic", "located in", "vault"]],
    [["heir", "child of", "regent"], ["regent", "parent of", "heir"]],
    [["relic", "owned by", "keeper"], ["keeper", "owns", "relic"]],
    [["guild", "has member", "scout"], ["scout", "member of", "guild"]],
  ] as Array<[[string, string, string], [string, string, string]]>)(
    "matches frozen evaluator-only inverse normalization for %j",
    (actual, expected) => expect(matches(actual, expected)).toBe(true),
  );

  it("accepts the narrowly enumerated leadership label for a broad association reference", () => {
    expect(matches(["captain", "leads", "order"], ["captain", "associated with", "order"])).toBe(true);
  });

  it("keeps unrelated labels in distinct exact freeform families", () => {
    expect(matches(["captain", "opposes", "order"], ["captain", "associated with", "order"])).toBe(false);
  });

  it("preserves direction after canonical normalization", () => {
    expect(matches(["relic", "located in", "vault"], ["vault", "located in", "relic"])).toBe(false);
  });

  it("does not turn genuinely different relationships into matches", () => {
    expect(matches(["keeper", "owns", "relic"], ["keeper", "parent of", "relic"])).toBe(false);
  });

  it("handles the conservative evaluator-only used-by inverse without changing production semantics", () => {
    const actual = canonicalizeRelationshipForScoring("relic", "keeper", "used by");
    expect(actual).toMatchObject({ sourceId: "keeper", targetId: "relic", primaryFamily: "possession_or_use" });
    expect(matches(["relic", "used by", "keeper"], ["keeper", "wielded or acquired", "relic"])).toBe(true);
  });

  it("classifies bounded family, bloodline, and target equivalences without fuzzy matching", () => {
    expect(classifyRelationshipScoringMatch({ sourceId: "child", relationshipType: "is daughter of", targetId: "parent" }, { sourceId: "parent", relationshipType: "parent of", targetId: "child" })).toBe("NORMALIZED_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "spirit", relationshipType: "has blood running in the veins of", targetId: "witch" }, { sourceId: "spirit", relationshipType: "is elemental spirit whose blood runs in", targetId: "witch" })).toBe("BOUNDED_SEMANTIC_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "pilot", relationshipType: "aims airship at", targetId: "city" }, { sourceId: "pilot", relationshipType: "aimed The Tempest at", targetId: "city" })).toBe("BOUNDED_SEMANTIC_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "pilot", relationshipType: "visits", targetId: "city" }, { sourceId: "pilot", relationshipType: "aimed The Tempest at", targetId: "city" })).toBe("NO_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "army", relationshipType: "commanded by", targetId: "general" }, { sourceId: "general", relationshipType: "commands", targetId: "army" })).toBe("NORMALIZED_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "nation", relationshipType: "invades", targetId: "other" }, { sourceId: "nation", relationshipType: "invaded", targetId: "other" })).toBe("BOUNDED_SEMANTIC_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "item", relationshipType: "was the source of power for", targetId: "emperor" }, { sourceId: "item", relationshipType: "was a source of power for", targetId: "emperor" })).toBe("BOUNDED_SEMANTIC_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "quest", relationshipType: "sent by", targetId: "academy" }, { sourceId: "quest", relationshipType: "is assigned by", targetId: "academy" })).toBe("BOUNDED_SEMANTIC_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "duke", relationshipType: "battled the forces of", targetId: "king" }, { sourceId: "duke", relationshipType: "battles", targetId: "king" })).toBe("BOUNDED_SEMANTIC_MATCH");
    expect(classifyRelationshipScoringMatch({ sourceId: "duke", relationshipType: "travels to", targetId: "king" }, { sourceId: "duke", relationshipType: "battles", targetId: "king" })).toBe("NO_MATCH");
  });

  const repositoryRoot = new URL("../", import.meta.url);
  const savedFixturePaths = {
    inventory: new URL("artifacts/wotbs-v3-completeness-sweep/final-inventory.json", repositoryRoot),
    qwen: new URL("artifacts/wotbs-graph-proof/raw-output.json", repositoryRoot),
    terra: new URL("artifacts/wotbs-graph-proof-terra/raw-output.json", repositoryRoot),
    gold: new URL("fixtures/wotbs-stage1/evaluation/WOTBS_STAGE1_GOLD_REFERENCE.json", repositoryRoot),
  };
  const savedFixturesAvailable = Object.values(savedFixturePaths).every((path) => existsSync(path));

  (savedFixturesAvailable ? it : it.skip)("deterministically rescores the exact saved Qwen and Terra fixtures", () => {
    const inventory = JSON.parse(readFileSync(savedFixturePaths.inventory, "utf8")) as ValidatedExtractionInventoryOutput;
    const gold = JSON.parse(readFileSync(savedFixturePaths.gold, "utf8")) as WotbsGoldReference;
    const scoreRawOutput = (path: URL) => {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { relationships: Array<{ source: string; target: string; relationship: string; page: number }> };
      const idsByName = new Map(inventory.entities.map((entity) => [normalizeName(entity.name), entity.temporary_id]));
      const candidates = raw.relationships.flatMap((relationship, index): CandidateRelationship[] => {
        const sourceId = idsByName.get(normalizeName(relationship.source));
        const targetId = idsByName.get(normalizeName(relationship.target));
        if (!sourceId || !targetId || sourceId === targetId) return [];
        return [{
        source_temporary_id: sourceId,
        target_temporary_id: targetId,
        relationship_type: relationship.relationship,
        description: relationship.relationship,
        confidence: 1,
        sources: [{ page_number: relationship.page, supporting_text: "Saved graph-proof fixture." }],
        __index: index,
      } as CandidateRelationship];
      });
      return { accepted: candidates.length, score: scoreWotbsRelationships(candidates, inventory, gold) };
    };
    const qwen = scoreRawOutput(savedFixturePaths.qwen);
    const terra = scoreRawOutput(savedFixturePaths.terra);
    expect(qwen).toMatchObject({ accepted: 26 });
    expect(qwen.score.recovered).toHaveLength(7);
    expect(terra).toMatchObject({ accepted: 37 });
    expect(terra.score.recovered).toHaveLength(8);
  });
});
