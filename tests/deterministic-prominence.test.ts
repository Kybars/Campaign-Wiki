import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { EntityType } from "@/lib/db/types";
import type { CanonicalEntity, CanonicalGraph } from "@/lib/graph/types";
import {
  applyDeterministicProminence,
  calculateProminenceScore,
  classifyEntityProminence,
  countSourceMentions,
  isSafeMentionAlias,
  scanSourceOccurrences,
  type SourceProminenceMetrics,
} from "@/lib/graph/prominence";

function entity(key: string, name: string, type: EntityType = "npc", aliases: string[] = []): CanonicalEntity {
  return { key, name, normalizedName: name.toLocaleLowerCase("en-US"), type, aliases, roles: [], roleSources: {}, summary: "", sources: [], candidateIds: [key], reconciliationEvidence: [], mergeReason: "deterministic" };
}

function metric(overrides: Partial<SourceProminenceMetrics> = {}): SourceProminenceMetrics {
  return { mentionCount: 0, mentionPageCount: 0, relationshipCount: 0, prominenceScore: 0, ...overrides };
}

describe("deterministic source mention counting", () => {
  it("counts every bounded canonical/alias occurrence, once per overlapping span, and tracks distinct pages", () => {
    const result = countSourceMentions(entity("drakus", "Drakus Coaltongue", "npc", ["Drakus", "Emperor Coaltongue", "Emperor"]), [
      { pageNumber: 1, text: "DRAKUS COALTONGUE met Drakus. Drakusson watched Emperor Coaltongue." },
      { pageNumber: 2, text: "drakus coaltongue returned; Drakus Coaltongue spoke." },
      { pageNumber: 3, text: "Nobody relevant appears here." },
    ]);
    expect(result).toEqual({ mentionCount: 5, mentionPageCount: 2 });
  });

  it("rejects short and generic single-token aliases but accepts specific names and phrases", () => {
    for (const unsafe of ["Io", "King", "Emperor", "Captain", "General", "Prince", "Princess", "Lord", "Lady"]) expect(isSafeMentionAlias(unsafe)).toBe(false);
    for (const safe of ["Drakus", "Emperor Coaltongue", "Moon Gate"]) expect(isSafeMentionAlias(safe)).toBe(true);
  });

  it("shares literal occurrence pages with provenance, retains inventory evidence, and counts repeated page mentions", () => {
    const subject = entity("drakus", "Drakus Coaltongue", "npc", ["Emperor Coaltongue"]);
    subject.sources = [{ page_number: 99, supporting_text: "Inventory evidence without a literal name." }];
    const pages = [
      { pageNumber: 3, text: "Drakus Coaltongue arrives." },
      { pageNumber: 6, text: "Emperor Coaltongue speaks. Drakus Coaltongue replies. Drakus Coaltongue leaves." },
      { pageNumber: 8, text: "No matching name." },
    ];
    const scan = scanSourceOccurrences(subject, pages);
    expect(scan.mentionCount).toBe(4);
    expect(scan.mentionPageCount).toBe(2);
    expect(scan.pageEvidence.map((item) => item.page_number)).toEqual([3, 6]);
    expect(scan.pageEvidence).toHaveLength(2);
    const graph: CanonicalGraph = { entities: [subject], relationships: [], facts: [], candidateToCanonical: new Map(), discardedRelationships: [], locationHierarchyDiagnostics: [], factAggregationDiagnostics: { candidateFactCount: 0, canonicalFactCount: 0, deduplicatedFactCount: 0, factEvidenceCount: 0 } };
    const result = applyDeterministicProminence(graph, pages).entities[0];
    expect(result).toMatchObject({ sourceMentionCount: 4, sourceMentionPageCount: 2 });
    expect(result.sources.map((item) => item.page_number)).toEqual([99, 3, 6]);
    expect(result.sources.filter((item) => item.page_number === 6)).toHaveLength(1);
    expect(result.sources.find((item) => item.page_number === 6)?.supporting_text).toContain("Emperor Coaltongue");
  });
});

describe("deterministic prominence scoring and classification", () => {
  it("weights page spread, raw mentions, and unique relationship count centrally", () => {
    expect(calculateProminenceScore({ mentionPageCount: 4, mentionCount: 7, relationshipCount: 3 })).toBe(25);
  });

  it.each([
    [1, ["major"]],
    [2, ["major", "supporting"]],
    [3, ["major", "supporting", "minor"]],
  ] as const)("handles a tiny group of %i", (count, expected) => {
    const entities = Array.from({ length: count }, (_, index) => entity(`e${index}`, `Entity ${index}`));
    const metrics = new Map(entities.map((item, index) => [item.key, metric({ prominenceScore: count - index })]));
    expect(entities.map((item) => classifyEntityProminence(entities, metrics).get(item.key))).toEqual(expected);
  });

  it("uses a 20/30/rest distribution, deterministic ties, and independent entity-type rankings", () => {
    const npcs = Array.from({ length: 10 }, (_, index) => entity(`npc-${index}`, `NPC ${String(index).padStart(2, "0")}`));
    const locations = [entity("z-location", "Zeta", "location"), entity("a-location", "Alpha", "location")];
    const all = [...npcs, ...locations];
    const metrics = new Map(all.map((item) => [item.key, metric()]));
    const result = classifyEntityProminence(all, metrics);
    expect(npcs.filter((item) => result.get(item.key) === "major")).toHaveLength(2);
    expect(npcs.filter((item) => result.get(item.key) === "supporting")).toHaveLength(3);
    expect(npcs.filter((item) => result.get(item.key) === "minor")).toHaveLength(5);
    expect(result.get("a-location")).toBe("major");
    expect(result.get("z-location")).toBe("supporting");
  });

  it("derives unique canonical relationship counts and defaults imported quests to not started", () => {
    const quest = entity("quest", "Save the Gate", "quest");
    const npc = entity("npc", "Mira");
    const graph: CanonicalGraph = {
      entities: [quest, npc], facts: [], candidateToCanonical: new Map(), discardedRelationships: [], locationHierarchyDiagnostics: [], factAggregationDiagnostics: { candidateFactCount: 0, canonicalFactCount: 0, deduplicatedFactCount: 0, factEvidenceCount: 0 },
      relationships: [{ key: "r1", sourceEntityKey: "quest", targetEntityKey: "npc", relationshipType: "involves", description: "", confidence: 1, sources: [], candidateRelationshipIds: [], normalization: { semanticType: "involves", forwardLabel: "involves", inverseLabel: "involves", originalRelationshipTypes: ["involves"], descriptions: [] } }],
    };
    const classified = applyDeterministicProminence(graph, [{ pageNumber: 1, text: "Save the Gate involves Mira." }]);
    expect(classified.entities.find((item) => item.key === "quest")).toMatchObject({ prominence: "major", prominenceReason: "Deterministic source score 6", questStatus: "not_started", sourceMentionCount: 1, sourceMentionPageCount: 1 });
  });
});

describe("automatic persistence and manual replay protection", () => {
  const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917091332_deterministic_entity_prominence.sql"), "utf8");
  const curationMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260916192058_v05_durable_gm_curation.sql"), "utf8");

  it("persists metrics and automatic quest status before the durable-curation wrapper restores manual values", () => {
    expect(migration).toContain("source_mention_count integer not null default 0");
    expect(migration).toContain("source_mention_page_count integer not null default 0");
    expect(migration).toContain("quest_status = case");
    expect(curationMigration).toContain("when (entity_override->>'prominence_is_manual')::boolean");
    expect(curationMigration).toContain("when (entity_override->>'quest_status_is_manual')::boolean");
  });
});
