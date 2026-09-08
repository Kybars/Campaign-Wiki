import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { richFactCachedChunks } from "@/fixtures/rich-fact-cache";
import { candidateEntitySchema, chunkExtractionSchema } from "@/lib/ai/schemas";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { validateChunkExtraction } from "@/lib/ai/source-validation";
import { buildEvaluationMetrics } from "@/lib/evaluation/metrics";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { normalizeFactContent } from "@/lib/graph/facts";
import { buildLocationHierarchy } from "@/lib/locations/hierarchy";
import { RICH_EXTRACTION_CACHE_SCHEMA_VERSION } from "@/lib/processing/cache-version";
import { aggregateCachedChunks } from "@/lib/processing/replay-cache";

function richReplay() {
  const aggregate = aggregateCachedChunks(richFactCachedChunks, RICH_EXTRACTION_CACHE_SCHEMA_VERSION);
  return { aggregate, graph: buildCanonicalGraph(aggregate) };
}

function factsFor(name: string) {
  const { graph } = richReplay();
  const entity = graph.entities.find((candidate) => candidate.name === name)!;
  return graph.facts.filter((fact) => fact.entityKey === entity.key);
}

function factFor(name: string, fieldKey: string, content?: string) {
  return factsFor(name).find((fact) => fact.fieldKey === fieldKey && (!content || fact.content === content));
}

describe("v0.3 Milestone 1 structured rich extraction", () => {
  it("accepts only type-specific bounded fact fields", () => {
    const base = {
      temporary_id: "mira",
      name: "Mira",
      type: "npc" as const,
      roles: [],
      aliases: [],
      summary: "A hunter.",
      sources: [{ page_number: 1, supporting_text: "Mira works as a hunter." }],
    };
    expect(candidateEntitySchema.parse({
      ...base,
      facts: [{ temporary_id: "occupation", field_key: "occupation", content: "Hunter", sources: base.sources }],
    }).facts).toHaveLength(1);
    expect(() => candidateEntitySchema.parse({
      ...base,
      facts: [{ temporary_id: "domain", field_key: "domain", content: "Sun", sources: base.sources }],
    })).toThrow();
  });

  it("converts the composable Zod schema into an OpenAI structured-output format without a model call", () => {
    const format = zodTextFormat(chunkExtractionSchema, "campaign_chunk_extraction");
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("campaign_chunk_extraction");
  });

  it("requires facts on v4 structured output while upgrading old factless caches explicitly", () => {
    const legacy = richFactCachedChunks[0].validated_output as Record<string, unknown>;
    const first = (legacy.entities as Array<Record<string, unknown>>)[0];
    expect(() => chunkExtractionSchema.parse({ ...legacy, entities: [{ ...first, facts: undefined }] })).toThrow();
    const oldAggregate = aggregateCachedChunks([{ chunk_id: "legacy", validated_output: {
      entities: [{ temporary_id: "old", name: "Old NPC", type: "npc", aliases: [], summary: "Old data.", sources: [{ page_number: 1, supporting_text: "Old NPC appears here." }] }],
      relationships: [],
    } }], 3);
    expect(oldAggregate.entities[0].facts).toEqual([]);
  });

  it("prompts for source facts, omission, fact evidence, and no outside canon", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("Unknown fields are omitted");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("Never add outside lore");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("Every fact needs its own short verbatim supporting excerpt");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("Do not duplicate these relationship-backed concepts as text facts");
  });

  it("preserves exact mechanics and separates narrative powers in the schema and prompt", () => {
    expect(factFor("Tideglass Blade", "mechanics")?.content).toBe("+2 bonus to attack and damage rolls");
    expect(factFor("Tideglass Blade", "special_power")?.content).toBe("Allows its bearer to breathe underwater");
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("Preserve exact mechanical wording");
  });
});

describe("v0.3 Milestone 1 source validation", () => {
  const pages = [{
    pageNumber: 7,
    text: "Mira is a hunter. The council asks Mira to find the lost beacon.",
  }];

  it("validates evidence against each specific fact and omits unsupported appearance/personality", () => {
    const result = validateChunkExtraction({
      entities: [{
        temporary_id: "mira",
        name: "Mira",
        type: "npc",
        roles: [],
        aliases: [],
        summary: "A hunter.",
        sources: [{ page_number: 7, supporting_text: "Mira is a hunter." }],
        facts: [
          { temporary_id: "job", field_key: "occupation", content: "Hunter", sources: [{ page_number: 7, supporting_text: "Mira is a hunter." }] },
          { temporary_id: "looks", field_key: "appearance", content: "Weather-beaten", sources: [{ page_number: 7, supporting_text: "Mira wears wolf furs and carries a bow." }] },
          { temporary_id: "temper", field_key: "personality", content: "Gruff", sources: [{ page_number: 7, supporting_text: "Mira is gruff and suspicious." }] },
        ],
      }],
      relationships: [],
    }, pages);
    expect(result.extraction.entities[0].facts.map((fact) => fact.field_key)).toEqual(["occupation"]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.kind === "fact")).toHaveLength(2);
  });

  it("keeps hooks only when their own source excerpt is present", () => {
    const result = validateChunkExtraction({
      entities: [{
        temporary_id: "mira", name: "Mira", type: "npc", roles: [], aliases: [], summary: "A hunter.",
        sources: [{ page_number: 7, supporting_text: "Mira is a hunter." }],
        facts: [
          { temporary_id: "hook-valid", field_key: "hook", content: "Asked to find the lost beacon", sources: [{ page_number: 7, supporting_text: "The council asks Mira to find the lost beacon." }] },
          { temporary_id: "hook-invented", field_key: "hook", content: "Could betray the party", sources: [{ page_number: 7, supporting_text: "Players could ask Mira to betray the council." }] },
        ],
      }], relationships: [],
    }, pages);
    expect(result.extraction.entities[0].facts.map((fact) => fact.temporary_id)).toEqual(["hook-valid"]);
  });

  it("rejects duplicate temporary fact IDs without confusing entity evidence", () => {
    const result = validateChunkExtraction({
      entities: [{
        temporary_id: "mira", name: "Mira", type: "npc", roles: [], aliases: [], summary: "A hunter.",
        sources: [{ page_number: 7, supporting_text: "Mira is a hunter." }],
        facts: [
          { temporary_id: "same", field_key: "occupation", content: "Hunter", sources: [{ page_number: 7, supporting_text: "Mira is a hunter." }] },
          { temporary_id: "same", field_key: "knowledge", content: "Knows of the beacon", sources: [{ page_number: 7, supporting_text: "The council asks Mira to find the lost beacon." }] },
        ],
      }], relationships: [],
    }, pages);
    expect(result.extraction.entities[0].facts).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ kind: "fact", reason: "duplicate fact temporary ID" }));
  });
});

describe("v0.3 Milestone 1 canonical fact aggregation", () => {
  it("remaps candidate facts to the reconciled canonical entity", () => {
    const { aggregate, graph } = richReplay();
    const candidateIds = aggregate.entities.filter((entity) => entity.name === "Mira Vale").map((entity) => entity.id);
    const canonicalKeys = new Set(candidateIds.map((id) => graph.candidateToCanonical.get(id)));
    expect(canonicalKeys.size).toBe(1);
    expect(factsFor("Mira Vale").every((fact) => canonicalKeys.has(fact.entityKey))).toBe(true);
  });

  it("deduplicates equivalent article facts conservatively", () => {
    expect(normalizeFactContent("a hunter")).toBe(normalizeFactContent("Hunter"));
    const occupations = factsFor("Mira Vale").filter((fact) => fact.fieldKey === "occupation");
    expect(occupations.map((fact) => fact.content)).toEqual(["a hunter", "Council guard"]);
  });

  it("retains multiple evidence records when an equivalent fact appears on two pages", () => {
    const hunter = factFor("Mira Vale", "occupation", "a hunter")!;
    expect(hunter.evidence.map((evidence) => evidence.pageNumber)).toEqual([1, 2]);
    expect(hunter.evidence[0].supportingText).not.toBe(hunter.evidence[1].supportingText);
  });

  it("retains distinct supported values in the same field", () => {
    expect(factsFor("Mira Vale").filter((fact) => fact.fieldKey === "occupation")).toHaveLength(2);
  });

  it("retains conflicting source statements as separate supported facts", () => {
    expect(factsFor("Emberwatch").filter((fact) => fact.fieldKey === "status").map((fact) => fact.content))
      .toEqual(["Destroyed", "Still standing"]);
    expect(factsFor("Mira Vale").filter((fact) => fact.fieldKey === "status").map((fact) => fact.content))
      .toEqual(["Missing", "Presumed dead"]);
  });

  it("gives canonical facts deterministic stable keys and candidate context", () => {
    const first = richReplay().graph.facts.map((fact) => fact.stableKey);
    const second = richReplay().graph.facts.map((fact) => fact.stableKey);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
    expect(factFor("Mira Vale", "occupation", "a hunter")?.context).toEqual({
      candidateFactIds: ["rich-1:mira:occupation-hunter", "rich-2:mira-again:occupation-hunter-again"],
    });
  });

  it("defaults all new facts safely without classifying entities, relationships, or prominence", () => {
    const { graph } = richReplay();
    expect(graph.facts.every((fact) => fact.visibility === "dm_only" && fact.origin === "document")).toBe(true);
    expect(graph.entities.every((entity) => entity.visibility === undefined && entity.prominence === undefined)).toBe(true);
    expect(graph.relationships.every((relationship) => relationship.visibility === undefined)).toBe(true);
  });

  it("does not generate Milestone 2 GM/player summaries", () => {
    const { graph } = richReplay();
    expect(graph.entities.every((entity) => entity.gmSummary === undefined && entity.playerSummary === undefined)).toBe(true);
  });

  it("records candidate, canonical, deduplicated, and evidence diagnostics", () => {
    const { aggregate, graph } = richReplay();
    const metrics = buildEvaluationMetrics(aggregate, graph);
    expect(metrics.candidateFactCount).toBeGreaterThan(metrics.canonicalFactCount);
    expect(metrics.deduplicatedFactCount).toBe(1);
    expect(metrics.factEvidenceCount).toBe(metrics.canonicalFactCount + 1);
  });
});

describe("v0.3 Milestone 1 primary entity coverage", () => {
  it("captures supported NPC occupation, appearance, personality, and hooks while leaving sparse fields absent", () => {
    expect(factFor("Mira Vale", "occupation")).toBeDefined();
    expect(factFor("Mira Vale", "appearance")).toBeDefined();
    expect(factFor("Mira Vale", "personality")).toBeDefined();
    expect(factFor("Mira Vale", "hook")).toBeDefined();
    expect(factsFor("Quiet Tom").map((fact) => fact.fieldKey)).toEqual(["occupation"]);
  });

  it("captures Location kind, first impression, atmosphere, and no invented sensory detail", () => {
    expect(factFor("Emberwatch", "place_kind")?.content).toBe("Coastal fortress");
    expect(factFor("Emberwatch", "first_impression")).toBeDefined();
    expect(factFor("Emberwatch", "atmosphere")).toBeDefined();
    expect(factFor("Emberwatch", "sensory_detail")).toBeUndefined();
  });

  it("keeps recursive location containment relationship-backed", () => {
    const { graph } = richReplay();
    expect(graph.facts.some((fact) => fact.fieldKey === "parent_location")).toBe(false);
    const hierarchy = buildLocationHierarchy(
      graph.entities.filter((entity) => entity.type === "location").map((entity) => ({ id: entity.key, name: entity.name })),
      graph.relationships.map((relationship) => ({ id: relationship.key, sourceId: relationship.sourceEntityKey, targetId: relationship.targetEntityKey, relationshipType: relationship.relationshipType, confidence: relationship.confidence })),
    );
    const gatehouse = graph.entities.find((entity) => entity.name === "Emberwatch Gatehouse")!;
    expect(hierarchy.getPath(gatehouse.key).map((entity) => entity.name)).toEqual(["Emberwatch", "Emberwatch Gatehouse"]);
  });

  it("captures explicit Deity domain and temperament and represents an avatar structurally", () => {
    expect(factFor("Solara", "domain")?.content).toBe("Sun");
    expect(factFor("Solara", "personality")?.content).toBe("Merciful");
    expect(factsFor("Solara").filter((fact) => fact.fieldKey === "domain")).toHaveLength(1);
    expect(richReplay().graph.relationships.some((relationship) => relationship.relationshipType === "avatar_of")).toBe(true);
  });

  it("captures Faction mission, ideology, and explicit Party Standing but never fabricates absent standing", () => {
    expect(factFor("Lantern Council", "purpose")).toBeDefined();
    expect(factFor("Lantern Council", "ideology")).toBeDefined();
    expect(factFor("Lantern Council", "party_standing")?.content).toBe("Suspicious");
    expect(factFor("Lantern Council", "standing_reason")).toBeDefined();
    expect(factsFor("Ash Oath").some((fact) => fact.fieldKey === "party_standing")).toBe(false);
  });

  it("keeps Faction leadership linkable instead of duplicating it as a fact", () => {
    const { graph } = richReplay();
    expect(graph.relationships.some((relationship) => relationship.relationshipType === "leader_of")).toBe(true);
    expect(factsFor("Lantern Council").some((fact) => fact.fieldKey === "leader")).toBe(false);
  });

  it("captures Item appearance and history without inventing mechanics", () => {
    expect(factFor("Tideglass Blade", "appearance")).toBeDefined();
    expect(factFor("Tideglass Blade", "history")).toBeDefined();
    expect(factsFor("Ash Oath").some((fact) => fact.fieldKey === "mechanics")).toBe(false);
  });

  it("keeps Item ownership structured and does not emit a current-owner fact", () => {
    const { graph } = richReplay();
    expect(graph.relationships.some((relationship) => relationship.relationshipType === "owns")).toBe(true);
    expect(factsFor("Tideglass Blade").some((fact) => fact.fieldKey === "current_owner")).toBe(false);
  });

  it("captures Quest objective and stakes, omits an absent reward, and preserves linked questgiver/place/item", () => {
    const { graph } = richReplay();
    expect(factFor("Relight the Beacon", "objective")).toBeDefined();
    expect(factFor("Relight the Beacon", "stakes")).toBeDefined();
    expect(factFor("Relight the Beacon", "reward")).toBeUndefined();
    expect(graph.relationships.filter((relationship) => ["questgiver_for", "concerns", "requires"].includes(relationship.relationshipType))).toHaveLength(3);
  });

  it("preserves exact and relative Event chronology without inventing another date", () => {
    const exact = factFor("Night of Ash", "exact_date")!;
    const relative = factFor("Night of Ash", "relative_chronology")!;
    expect(exact.structuredValue).toEqual({ chronologyKind: "exact", sourceText: "14 Frostfall 1023" });
    expect(relative.structuredValue).toEqual({ chronologyKind: "relative", sourceText: "Three days after the comet fell" });
    expect(factsFor("Night of Ash").filter((fact) => fact.fieldKey === "exact_date")).toHaveLength(1);
  });

  it("allows unknown Event chronology through absence rather than a fabricated placeholder", () => {
    const undatedFacts = factsFor("Undated Muster");
    expect(undatedFacts.map((fact) => fact.fieldKey)).toEqual(["what_happened"]);
  });

  it("keeps Other as a simple source-backed fallback", () => {
    expect(factsFor("Ash Oath")).toEqual([expect.objectContaining({ fieldKey: "detail" })]);
  });
});

describe("v0.3 Milestone 1 provenance, relationships, and replay", () => {
  it("requires evidence for every canonical fact and keeps excerpts fact-specific", () => {
    const { graph } = richReplay();
    expect(graph.facts.every((fact) => fact.evidence.length > 0)).toBe(true);
    const appearance = factFor("Mira Vale", "appearance")!;
    const personality = factFor("Mira Vale", "personality")!;
    expect(appearance.evidence[0].supportingText).not.toBe(personality.evidence[0].supportingText);
  });

  it("keeps relationship-backed knowledge out of generic facts", () => {
    const { graph } = richReplay();
    const forbidden = new Set(["current_owner", "owner", "leader", "questgiver", "parent_location", "participant", "event_location"]);
    expect(graph.facts.some((fact) => forbidden.has(fact.fieldKey))).toBe(false);
    expect(graph.relationships.length).toBeGreaterThan(0);
    expect(graph.relationships.some((relationship) => relationship.relationshipType === "previously_owned_by")).toBe(true);
    expect(graph.relationships.some((relationship) => relationship.relationshipType === "involved")).toBe(true);
  });

  it("replays v4 rich output deterministically without an OpenAI boundary", () => {
    const first = richReplay();
    const second = richReplay();
    expect(second.graph.facts).toEqual(first.graph.facts);
    expect(second.graph.entities).toEqual(first.graph.entities);
  });

  it("does not let a v4 cache silently omit the rich fact contract", () => {
    const invalid = [{ chunk_id: "v4-invalid", validated_output: {
      entities: [{ temporary_id: "x", name: "X", type: "other", roles: [], aliases: [], summary: "Named thing.", sources: [{ page_number: 1, supporting_text: "The named thing is X." }] }],
      relationships: [],
    } }];
    expect(() => aggregateCachedChunks(invalid, RICH_EXTRACTION_CACHE_SCHEMA_VERSION)).toThrow();
  });

  it("keeps legacy Test 2-style cache data loadable but explicitly factless", () => {
    const legacy = aggregateCachedChunks([{ chunk_id: "test-2", validated_output: {
      entities: [{ temporary_id: "colinus", name: "Colinus", type: "npc", roles: [], aliases: [], summary: "A councilmember.", sources: [{ page_number: 27, supporting_text: "Colinus is a councilmember." }] }],
      relationships: [],
    } }], 3);
    const graph = buildCanonicalGraph(legacy);
    expect(graph.entities).toHaveLength(1);
    expect(graph.facts).toEqual([]);
  });

  it("persists all rich facts and evidence through the existing canonical graph payload", async () => {
    const { canonicalGraphPersistencePayload } = await import("@/lib/graph/persistence");
    const { graph } = richReplay();
    const payload = canonicalGraphPersistencePayload(graph);
    expect(payload.facts).toHaveLength(graph.facts.length);
    expect(payload.facts.every((fact) => fact.entityKey && fact.stableKey && fact.evidence.length > 0)).toBe(true);
  });
});
