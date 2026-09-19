import { describe, expect, it, vi } from "vitest";
import {
  adjudicateDuplicateCandidates,
  applyEntityMerges,
  applyExplicitIdentityRelationships,
  buildDuplicateCandidates,
  duplicateAdjudicationCheckpointIdentity,
  validateDuplicateAdjudication,
  type DuplicateAdjudication,
  type GraphInventory,
} from "@/lib/ai/entity-reconciliation";
import { resolveRawRelationships } from "@/lib/ai/graph-extraction";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { buildLeanGraphCore } from "@/lib/processing/graph-core";
import { canonicalGraphPersistencePayload } from "@/lib/graph/persistence";

const source = (page: number, text: string) => ({ page_number: page, supporting_text: text.padEnd(8, ".") });
const entity = (temporary_id: string, name: string, type: GraphInventory["entities"][number]["type"], page = 1) => ({ temporary_id, name, type, aliases: [], memberIds: [temporary_id], sources: [source(page, `${name} appears here`)] });

const rawChunks = [{ chunkId: "chunk", raw: { relationships: [
  { source: "The Masked One", relationship: "is also known as", target: "Nerezza", page: 1 },
] } }];

describe("deterministic duplicate candidates", () => {
  const inventory: GraphInventory = { entities: [
    entity("dassen-location", "Dassen", "location"),
    entity("dassen-faction", "Dassen", "faction"),
    entity("chasm-a", "The Singing Chasm", "location"),
    entity("chasm-b", "Singing Chasm", "location"),
    entity("forest-a", "Fire Forest of Innenotdar", "location"),
    entity("forest-b", "Innenotdar Fire Forest", "location"),
    entity("king", "King Ardan", "npc"),
    entity("ardan", "Ardan", "npc"),
    entity("masked", "The Masked One", "npc"),
    entity("nerezza", "Nerezza", "npc"),
    entity("silver", "Silver Guard", "faction"),
    entity("golden", "Golden Guard", "faction"),
  ] };

  it("uses only strong exact, article, token-order, title, and explicit-alias signals", () => {
    const candidates = buildDuplicateCandidates(inventory, rawChunks);
    const pair = (left: string, right: string) => candidates.pairs.find((item) => new Set([item.leftId, item.rightId]).size === 2 && [left, right].every((id) => [item.leftId, item.rightId].includes(id)));
    expect(pair("dassen-location", "dassen-faction")?.reasons).toContain("exact_name");
    expect(pair("chasm-a", "chasm-b")?.reasons).toContain("article_variant");
    expect(pair("forest-a", "forest-b")?.reasons).toContain("token_reorder");
    expect(pair("king", "ardan")?.reasons).toContain("npc_title_variant");
    expect(pair("masked", "nerezza")?.reasons).toContain("explicit_alias");
    expect(pair("silver", "golden")).toBeUndefined();
  });

  it("offers short/formal polity variants to adjudication without treating generic subgroups as duplicates", () => {
    const candidates = buildDuplicateCandidates({ entities: [
      entity("ragesia", "Ragesia", "faction"),
      entity("empire", "Ragesian Empire", "faction"),
      entity("inquisitors", "Inquisitors", "faction"),
      entity("ragesian-inquisitors", "Ragesian Inquisitors", "faction"),
      entity("scourge", "The Scourge", "faction"),
    ] }, []);
    expect(candidates.pairs).toContainEqual(expect.objectContaining({ leftId: "empire", rightId: "ragesia", reasons: ["polity_formal_variant"] }));
    expect(candidates.pairs.some((pair) => [pair.leftId, pair.rightId].includes("inquisitors") && [pair.leftId, pair.rightId].includes("ragesian-inquisitors"))).toBe(false);
  });
});

describe("duplicate adjudication validation", () => {
  const inventory: GraphInventory = { entities: [entity("a", "The Trial of Echoed Souls", "event"), entity("b", "Trial of Echoed Souls", "event"), entity("c", "Trial Echoed Souls", "event")] };
  const candidates = buildDuplicateCandidates(inventory, []);

  it("accepts a valid merge group and a valid review-only decision", () => {
    expect(validateDuplicateAdjudication({ merge_groups: [{ member_ids: ["a", "b"], canonical_member_id: "b" }], review_pairs: [] }, candidates).merge_groups).toHaveLength(1);
    expect(validateDuplicateAdjudication({ merge_groups: [], review_pairs: [{ left_id: "b", right_id: "c" }] }, candidates).review_pairs).toHaveLength(1);
  });

  it("rejects unknown IDs, overlapping groups, out-of-candidate merges, and invented canonicals", () => {
    expect(() => validateDuplicateAdjudication({ merge_groups: [{ member_ids: ["a", "unknown"], canonical_member_id: "a" }], review_pairs: [] }, candidates)).toThrow(/candidate component/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [{ member_ids: ["a", "b"], canonical_member_id: "a" }, { member_ids: ["b", "c"], canonical_member_id: "b" }], review_pairs: [] }, candidates)).toThrow(/overlapping/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [{ member_ids: ["a", "separate"], canonical_member_id: "a" }], review_pairs: [] }, candidates)).toThrow(/candidate component/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [{ member_ids: ["a", "b"], canonical_member_id: "invented" }], review_pairs: [] }, candidates)).toThrow(/invented/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [{ member_ids: ["a", "b"], canonical_member_id: "a" }], review_pairs: [{ left_id: "b", right_id: "c" }] }, candidates)).toThrow(/review pair/);
  });
});

describe("merge application and raw relationship recovery", () => {
  const inventory: GraphInventory = { entities: [
    { ...entity("drakus", "Drakus Coaltongue", "npc", 1), sources: [source(1, "Drakus Coaltongue rules Ragesia.")] },
    { ...entity("emperor", "Emperor Coaltongue", "npc", 2), sources: [source(2, "Emperor Coaltongue owns the Torch.")] },
    entity("torch", "Torch", "item", 2),
    entity("dassen-a", "Dassen", "location", 1),
    entity("dassen-b", "Dassen", "faction", 1),
  ] };
  const decision: DuplicateAdjudication = { merge_groups: [{ member_ids: ["drakus", "emperor"], canonical_member_id: "drakus" }, { member_ids: ["dassen-a", "dassen-b"], canonical_member_id: "dassen-a" }], review_pairs: [] };
  const chunk = { id: "chunk", characterCount: 200, pages: [{ pageNumber: 2, text: "Emperor Coaltongue owns the Torch. Drakus Coaltongue owns the Torch. Nobody owns the Torch." }] };

  it("preserves the canonical member, type, member names, provenance, and deterministic output", () => {
    const first = applyEntityMerges(inventory, decision);
    const second = applyEntityMerges(inventory, decision);
    const drakus = first.inventory.entities.find((item) => item.temporary_id === "drakus")!;
    expect(drakus).toMatchObject({ name: "Drakus Coaltongue", type: "npc", aliases: ["Emperor Coaltongue"], memberIds: ["drakus", "emperor"] });
    expect(drakus.sources.map((item) => item.page_number)).toEqual([1, 2]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.resolutionKeys.get("emperor coaltongue")).toEqual(["drakus"]);
  });

  it("deterministically merges only explicit NPC same-person relationships before adjudication", () => {
    const identity = applyExplicitIdentityRelationships(inventory, [{ chunkId: "chunk", validPages: [2], raw: { relationships: [
      { source: "Emperor Coaltongue", relationship: "same person as", target: "Drakus Coaltongue", page: 2 },
      { source: "Dassen", relationship: "same person as", target: "Torch", page: 2 },
    ] } }]);
    const drakus = identity.inventory.entities.find((item) => item.temporary_id === "drakus")!;
    expect(identity.inventory.entities.filter((item) => item.type === "npc")).toHaveLength(1);
    expect(drakus.aliases).toContain("Emperor Coaltongue");
    expect(drakus.sources.map((item) => item.page_number)).toEqual([1, 2]);
    const resolved = resolveRawRelationships({ relationships: [{ source: "Emperor Coaltongue", relationship: "same person as", target: "Drakus Coaltongue", page: 2 }] }, identity.inventory, chunk);
    expect(resolved.relationships).toEqual([]);
    expect(resolved.selfEdgeRejections).toBe(1);
  });

  it("recovers ambiguous and alias-named endpoints, rejects unknown/self edges, and dedupes recovered edges", () => {
    expect(resolveRawRelationships({ relationships: [{ source: "Dassen", relationship: "owns", target: "Torch", page: 2 }] }, inventory, chunk).ambiguousEndpointRejections).toBe(1);
    const merged = applyEntityMerges(inventory, decision).inventory;
    const validation = resolveRawRelationships({ relationships: [
      { source: "Emperor Coaltongue", relationship: "owns", target: "Torch", page: 2 },
      { source: "Drakus Coaltongue", relationship: "owns", target: "Torch", page: 2 },
      { source: "Nobody", relationship: "owns", target: "Torch", page: 2 },
      { source: "Drakus Coaltongue", relationship: "is also known as", target: "Emperor Coaltongue", page: 2 },
      { source: "Dassen", relationship: "owns", target: "Torch", page: 2 },
    ] }, merged, chunk);
    expect(validation.relationships).toHaveLength(2);
    expect(validation.relationships[0]).toMatchObject({ sourceInventoryId: "drakus", targetInventoryId: "torch" });
    expect(validation.duplicateSemanticEdges).toBe(1);
    expect(validation.unknownEndpointRejections).toBe(1);
    expect(validation.selfEdgeRejections).toBe(1);
    expect(validation.relationships.some((item) => item.sourceInventoryId === "dassen-a")).toBe(true);
  });

  it("keeps an exact endpoint ambiguous when its candidate was not merged", () => {
    const unmerged = applyEntityMerges(inventory, { merge_groups: [], review_pairs: [{ left_id: "dassen-a", right_id: "dassen-b" }] }).inventory;
    const validation = resolveRawRelationships({ relationships: [{ source: "Dassen", relationship: "owns", target: "Torch", page: 2 }] }, unmerged, chunk);
    expect(validation.relationships).toEqual([]);
    expect(validation.ambiguousEndpointRejections).toBe(1);
  });

  it("replay of the same merge and raw first pass yields an identical final graph", () => {
    const raw = { relationships: [{ source: "Emperor Coaltongue", relationship: "owns", target: "Torch", page: 2 }] };
    const build = () => {
      const merged = applyEntityMerges(inventory, decision).inventory;
      const firstPass = resolveRawRelationships(raw, merged, chunk).relationships;
      return canonicalGraphPersistencePayload(buildLeanGraphCore(merged, [chunk], [{ chunkId: "chunk", rawFirstPass: raw, firstPass, completeness: [], relationships: firstPass, firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE" }]));
    };
    expect(build()).toEqual(build());
  });
});

describe("duplicate adjudication checkpointing and call suppression", () => {
  const usage = { model: "model", responseId: null, inputTokens: 1, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null };
  function provider(output: DuplicateAdjudication) {
    const parseStructured = vi.fn(async () => ({ output, providerId: "openai" as const, modelId: "model", responseId: null, usage }));
    return { providerId: "openai" as const, modelId: "model", parseStructured } as unknown as StructuredModelProvider & { parseStructured: typeof parseStructured };
  }

  it("reuses a validated adjudication and includes first-pass/candidate fingerprints in identity", async () => {
    const inventory: GraphInventory = { entities: [entity("a", "The Chasm", "location"), entity("b", "Chasm", "location")] };
    const candidates = buildDuplicateCandidates(inventory, []);
    const model = provider({ merge_groups: [{ member_ids: ["a", "b"], canonical_member_id: "b" }], review_pairs: [] });
    const store = memoryCheckpointStore();
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store };
    const first = await adjudicateDuplicateCandidates(inventory, candidates, [], model, context);
    const replay = await adjudicateDuplicateCandidates(inventory, candidates, [], model, context);
    expect(first.checkpointStatus).toBe("RUN");
    expect(replay.checkpointStatus).toBe("REUSE");
    expect(model.parseStructured).toHaveBeenCalledOnce();
    const identity = duplicateAdjudicationCheckpointIdentity(inventory, candidates, [], model, context);
    const changed = duplicateAdjudicationCheckpointIdentity(inventory, candidates, [{ chunkId: "x", raw: { relationships: [] } }], model, context);
    expect(identity.upstreamFingerprint).not.toBe(changed.upstreamFingerprint);
  });

  it("makes zero model calls when there are no candidates", async () => {
    const inventory: GraphInventory = { entities: [entity("a", "Silver Guard", "faction"), entity("b", "Golden Guard", "faction")] };
    const candidates = buildDuplicateCandidates(inventory, []);
    const model = provider({ merge_groups: [], review_pairs: [] });
    const result = await adjudicateDuplicateCandidates(inventory, candidates, [], model, { campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store: memoryCheckpointStore() });
    expect(result.checkpointStatus).toBe("REUSE");
    expect(model.parseStructured).not.toHaveBeenCalled();
  });
});
