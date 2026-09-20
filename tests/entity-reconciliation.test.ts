import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  adjudicateDuplicateCandidates,
  applyEntityMerges,
  applyExplicitIdentityRelationships,
  buildDuplicateAdjudicationBatches,
  buildDuplicateCandidates,
  duplicateAdjudicationCheckpointIdentity,
  duplicateAdjudicationSchema,
  MAX_DUPLICATE_ADJUDICATION_BATCH_PAIRS,
  MAX_DUPLICATE_ADJUDICATION_BATCH_PAYLOAD_BYTES,
  planDuplicateAdjudication,
  validateDuplicateAdjudication,
  type DuplicateAdjudication,
  type GraphInventory,
} from "@/lib/ai/entity-reconciliation";
import { resolveRawRelationships } from "@/lib/ai/graph-extraction";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { buildLeanGraphCore, finalizeRawRelationshipPasses } from "@/lib/processing/graph-core";
import { canonicalGraphPersistencePayload } from "@/lib/graph/persistence";

const source = (page: number, text: string) => ({ page_number: page, supporting_text: text.padEnd(8, ".") });
const entity = (temporary_id: string, name: string, type: GraphInventory["entities"][number]["type"], page = 1) => ({ temporary_id, name, type, aliases: [], memberIds: [temporary_id], sources: [source(page, `${name} appears here`)] });

const rawChunks = [{ chunkId: "chunk", raw: { relationships: [
  { source: "The Masked One", relationship: "is also known as", target: "Nerezza", page: 1, evidence_quote: "The Masked One is also known as Nerezza." },
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

  it("offers short/formal polity and qualified subgroup names to conservative adjudication", () => {
    const candidates = buildDuplicateCandidates({ entities: [
      entity("ragesia", "Ragesia", "faction"),
      entity("empire", "Ragesian Empire", "faction"),
      entity("inquisitors", "Inquisitors", "faction"),
      entity("ragesian-inquisitors", "Ragesian Inquisitors", "faction"),
      entity("scourge", "The Scourge", "faction"),
    ] }, []);
    expect(candidates.pairs.find((pair) => pair.leftId === "empire" && pair.rightId === "ragesia")?.reasons).toContain("polity_formal_variant");
    expect(candidates.pairs.find((pair) => [pair.leftId, pair.rightId].includes("inquisitors") && [pair.leftId, pair.rightId].includes("ragesian-inquisitors"))?.reasons).toContain("name_contains_distinctive");
  });

  it("uses bounded high-recall blocking for organization, place, cross-type, and title variants without hard-merging them", () => {
    const candidates = buildDuplicateCandidates({ entities: [
      entity("watchers", "Watchers", "faction"),
      entity("ashen-watchers", "Ashen Watchers", "faction"),
      entity("knights", "Knights of the Dawn Cross", "faction"),
      entity("order", "Order of the Dawn Cross", "faction"),
      entity("wood", "Elarin", "location"),
      entity("forest", "Fire Forest of Elarin", "location"),
      entity("war-event", "War of Falling Stars", "event"),
      entity("war-other", "War of Falling Stars", "other"),
      entity("mira", "Mira", "npc"),
      entity("supreme-mira", "Supreme Inquisitor Mira", "npc"),
      entity("army", "Ashen Army", "faction"),
      entity("empire", "Ashen Empire", "faction"),
    ] }, []);
    const hasPair = (left: string, right: string) => candidates.pairs.find((pair) => [left, right].every((id) => [pair.leftId, pair.rightId].includes(id)));
    expect(hasPair("watchers", "ashen-watchers")?.reasons).toContain("name_contains_distinctive");
    expect(hasPair("knights", "order")?.reasons).toContain("organization_qualifier_variant");
    expect(hasPair("wood", "forest")?.reasons).toContain("name_contains_distinctive");
    expect(hasPair("war-event", "war-other")?.reasons).toContain("exact_name");
    expect(hasPair("mira", "supreme-mira")?.reasons).toContain("npc_title_variant");
    expect(hasPair("army", "empire")).toBeDefined();
    expect(candidates.pairs.length).toBeLessThanOrEqual(500);
  });

  it("caps broad lexical blocks globally and per entity", () => {
    const crowded: GraphInventory = { entities: Array.from({ length: 30 }, (_, index) => entity(`guard-${index}`, `Azure Guard ${index}`, "faction")) };
    const candidates = buildDuplicateCandidates(crowded, []);
    const counts = new Map<string, number>();
    for (const pair of candidates.pairs) for (const id of [pair.leftId, pair.rightId]) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(candidates.pairs.length).toBeLessThanOrEqual(500);
    expect(Math.max(0, ...counts.values())).toBeLessThanOrEqual(16);
  });
});

describe("duplicate adjudication validation", () => {
  const inventory: GraphInventory = { entities: [entity("a", "The Trial of Echoed Souls", "event"), entity("b", "Trial of Echoed Souls", "event"), entity("c", "Trial Echoed Souls", "event")] };
  const candidates = buildDuplicateCandidates(inventory, []);

  it("accepts authoritative pair decisions independent of proposed merge groups", () => {
    const decisions = (outcome: "MERGE" | "KEEP_SEPARATE" | "REVIEW") => candidates.pairs.map((pair) => ({ left_id: pair.leftId, right_id: pair.rightId, outcome, reason_code: "NAME_VARIANT_STRONG" as const, evidence_pages: [1], explanation: null }));
    const accepted = validateDuplicateAdjudication({ merge_groups: [], review_pairs: [], pair_decisions: decisions("MERGE") }, candidates, inventory);
    expect(applyEntityMerges(inventory, accepted).inventory.entities).toHaveLength(1);
    expect(validateDuplicateAdjudication({ merge_groups: [], review_pairs: [{ left_id: "b", right_id: "c" }], pair_decisions: decisions("REVIEW") }, candidates).review_pairs).toHaveLength(1);
  });

  it("rejects unknown, missing, repeated, and inconsistent pair decisions", () => {
    const decisions = (outcome: "MERGE" | "REVIEW") => candidates.pairs.map((pair) => ({ left_id: pair.leftId, right_id: pair.rightId, outcome, reason_code: "NAME_VARIANT_STRONG" as const, evidence_pages: [1], explanation: null }));
    expect(() => validateDuplicateAdjudication({ merge_groups: [], review_pairs: [], pair_decisions: [...decisions("MERGE"), { left_id: "a", right_id: "unknown", outcome: "MERGE", reason_code: "NAME_VARIANT_STRONG", evidence_pages: [1], explanation: null }] }, candidates)).toThrow(/not offered/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [], review_pairs: [], pair_decisions: decisions("MERGE").slice(1) }, candidates)).toThrow(/decide every/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [], review_pairs: [], pair_decisions: [...decisions("MERGE"), decisions("MERGE")[0]] }, candidates)).toThrow(/repeated/);
    expect(() => validateDuplicateAdjudication({ merge_groups: [], review_pairs: [{ left_id: "b", right_id: "c" }], pair_decisions: decisions("MERGE") }, candidates)).toThrow(/Review pair/);
  });

  it("merges a transitive component even when the model omits merge_groups", () => {
    const decisions = candidates.pairs.map((pair) => ({ left_id: pair.leftId, right_id: pair.rightId, outcome: "MERGE" as const, reason_code: "NAME_VARIANT_STRONG" as const, evidence_pages: [1], explanation: null }));
    const decision = validateDuplicateAdjudication({
      merge_groups: [],
      review_pairs: [],
      pair_decisions: decisions,
    }, candidates, inventory);
    const applied = applyEntityMerges(inventory, decision);
    expect(applied.inventory.entities).toEqual([expect.objectContaining({ temporary_id: "a", name: "The Trial of Echoed Souls", type: "event", memberIds: ["a", "b", "c"] })]);
    expect(applied.applications.every((item) => item.outcome === "APPLIED")).toBe(true);
  });

  it("keeps a conflicted overlapping component separate and escalates its explicit keep-separate pair", () => {
    const decisions = candidates.pairs.map((pair) => ({
      left_id: pair.leftId,
      right_id: pair.rightId,
      outcome: pair.leftId === "a" && pair.rightId === "c" ? "KEEP_SEPARATE" as const : "MERGE" as const,
      reason_code: pair.leftId === "a" && pair.rightId === "c" ? "DISTINCT_ENTITY_TYPE_CONTEXT" as const : "NAME_VARIANT_STRONG" as const,
      evidence_pages: [1],
      explanation: null,
    }));
    const decision = validateDuplicateAdjudication({
      merge_groups: [
        { member_ids: ["a", "b"], canonical_member_id: "a", canonical_name: "The Trial of Echoed Souls", canonical_type: "event" },
        { member_ids: ["b", "c"], canonical_member_id: "b", canonical_name: "Trial of Echoed Souls", canonical_type: "event" },
      ],
      review_pairs: [],
      pair_decisions: decisions,
    }, candidates, inventory);
    expect(decision.pair_decisions.find((pair) => pair.left_id === "a" && pair.right_id === "c")?.outcome).toBe("KEEP_SEPARATE");
    const applied = applyEntityMerges(inventory, decision);
    expect(applied.inventory.entities).toHaveLength(3);
    expect(applied.reviewPairs).toContainEqual({ left_id: "a", right_id: "c" });
    expect(applied.applications.filter((item) => item.outcome === "CONFLICT_BLOCKED")).toHaveLength(2);
    expect(applied.applications.every((item) => item.conflict_reason === "KEEP_SEPARATE_INSIDE_TRANSITIVE_COMPONENT")).toBe(true);
  });
});

describe("duplicate adjudication OpenAI schema", () => {
  it("has no unsupported optional object properties", () => {
    const schema = z.toJSONSchema(duplicateAdjudicationSchema) as unknown;
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "object" && record.properties && typeof record.properties === "object") {
        const propertyNames = Object.keys(record.properties);
        expect(record.required).toEqual(propertyNames);
      }
      Object.values(record).forEach(visit);
    };
    visit(schema);
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
  const decision: DuplicateAdjudication = { merge_groups: [], review_pairs: [], pair_decisions: [
    { left_id: "drakus", right_id: "emperor", outcome: "MERGE", reason_code: "SAME_REFERENT_CONTEXTUAL", evidence_pages: [1, 2], explanation: null },
    { left_id: "dassen-a", right_id: "dassen-b", outcome: "MERGE", reason_code: "SAME_REFERENT_CONTEXTUAL", evidence_pages: [1], explanation: null },
  ] };
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

  it("chooses canonical name and type deterministically from existing members", () => {
    const crossType: GraphInventory = { entities: [entity("fallback", "War of Falling Stars", "other"), entity("event", "The War of Falling Stars", "event")] };
    const pairs: DuplicateAdjudication["pair_decisions"] = [{ left_id: "fallback", right_id: "event", outcome: "MERGE", reason_code: "SAME_REFERENT_CONTEXTUAL", evidence_pages: [1], explanation: null }];
    const merged = applyEntityMerges(crossType, { merge_groups: [{ member_ids: ["fallback", "event"], canonical_member_id: "fallback", canonical_name: "Invented War", canonical_type: "other" }], review_pairs: [], pair_decisions: pairs });
    expect(merged.inventory.entities).toEqual([expect.objectContaining({ temporary_id: "event", name: "The War of Falling Stars", type: "event", aliases: ["War of Falling Stars"] })]);
  });

  it("deterministically merges only explicit NPC same-person relationships before adjudication", () => {
    const identity = applyExplicitIdentityRelationships(inventory, [{ chunkId: "chunk", validPages: [2], raw: { relationships: [
      { source: "Emperor Coaltongue", relationship: "same person as", target: "Drakus Coaltongue", page: 2, evidence_quote: "Emperor Coaltongue owns the Torch." },
      { source: "Dassen", relationship: "same person as", target: "Torch", page: 2, evidence_quote: "Nobody owns the Torch." },
    ] } }]);
    const drakus = identity.inventory.entities.find((item) => item.temporary_id === "drakus")!;
    expect(identity.inventory.entities.filter((item) => item.type === "npc")).toHaveLength(1);
    expect(drakus.aliases).toContain("Emperor Coaltongue");
    expect(drakus.sources.map((item) => item.page_number)).toEqual([1, 2]);
    const resolved = resolveRawRelationships({ relationships: [{ source: "Emperor Coaltongue", relationship: "same person as", target: "Drakus Coaltongue", page: 2, evidence_quote: "Emperor Coaltongue owns the Torch." }] }, identity.inventory, chunk);
    expect(resolved.relationships).toEqual([]);
    expect(resolved.selfEdgeRejections).toBe(1);
  });

  it("recovers ambiguous and alias-named endpoints, rejects unknown/self edges, and dedupes recovered edges", () => {
    expect(resolveRawRelationships({ relationships: [{ source: "Dassen", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Nobody owns the Torch." }] }, inventory, chunk).ambiguousEndpointRejections).toBe(1);
    const merged = applyEntityMerges(inventory, decision).inventory;
    const validation = resolveRawRelationships({ relationships: [
      { source: "Emperor Coaltongue", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Emperor Coaltongue owns the Torch." },
      { source: "Drakus Coaltongue", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Drakus Coaltongue owns the Torch." },
      { source: "Nobody", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Nobody owns the Torch." },
      { source: "Drakus Coaltongue", relationship: "is also known as", target: "Emperor Coaltongue", page: 2, evidence_quote: "Drakus Coaltongue owns the Torch." },
      { source: "Dassen", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Nobody owns the Torch." },
    ] }, merged, chunk);
    // Both quote-backed raw proposals survive validation so graph aggregation can union provenance.
    expect(validation.relationships).toHaveLength(3);
    expect(validation.relationships[0]).toMatchObject({ sourceInventoryId: "drakus", targetInventoryId: "torch" });
    expect(validation.duplicateSemanticEdges).toBe(1);
    expect(validation.unknownEndpointRejections).toBe(1);
    expect(validation.selfEdgeRejections).toBe(1);
    expect(validation.relationships.some((item) => item.sourceInventoryId === "dassen-a")).toBe(true);
  });

  it("keeps an exact endpoint ambiguous when its candidate was not merged", () => {
    const unmerged = applyEntityMerges(inventory, { merge_groups: [], review_pairs: [{ left_id: "dassen-a", right_id: "dassen-b" }], pair_decisions: [] }).inventory;
    const validation = resolveRawRelationships({ relationships: [{ source: "Dassen", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Nobody owns the Torch." }] }, unmerged, chunk);
    expect(validation.relationships).toEqual([]);
    expect(validation.ambiguousEndpointRejections).toBe(1);
  });

  it("replay of the same merge and raw first pass yields an identical final graph", () => {
    const raw = { relationships: [{ source: "Emperor Coaltongue", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Emperor Coaltongue owns the Torch." }] };
    const build = () => {
      const merged = applyEntityMerges(inventory, decision).inventory;
      const firstPass = resolveRawRelationships(raw, merged, chunk).relationships;
      return canonicalGraphPersistencePayload(buildLeanGraphCore(merged, [chunk], [{ chunkId: "chunk", rawFirstPass: raw, firstPass, completeness: [], relationships: firstPass, firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE" }]));
    };
    expect(build()).toEqual(build());
  });

  it("finalizes raw passes against merged IDs, audits resulting self-edges, and retains no stale endpoint IDs", () => {
    const merged = applyEntityMerges(inventory, decision).inventory;
    const finalized = finalizeRawRelationshipPasses([{ chunkId: "chunk", raw: { relationships: [
      { source: "Emperor Coaltongue", relationship: "same person as", target: "Drakus Coaltongue", page: 2, evidence_quote: "Emperor Coaltongue owns the Torch." },
      { source: "Emperor Coaltongue", relationship: "owns", target: "Torch", page: 2, evidence_quote: "Emperor Coaltongue owns the Torch." },
    ] } }], [chunk], merged)[0];
    expect(finalized.validationRecords[0]).toMatchObject({ outcome: "REJECTED_SELF_EDGE", resolvedSourceEntityId: "drakus", resolvedTargetEntityId: "drakus" });
    expect(finalized.relationships).toEqual([expect.objectContaining({ sourceInventoryId: "drakus", targetInventoryId: "torch" })]);
    expect(finalized.relationships.flatMap((relationship) => [relationship.sourceInventoryId, relationship.targetInventoryId])).not.toContain("emperor");
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
    const model = provider({ merge_groups: [{ member_ids: ["a", "b"], canonical_member_id: "b", canonical_name: "Chasm", canonical_type: "location" }], review_pairs: [], pair_decisions: candidates.pairs.map((pair) => ({ left_id: pair.leftId, right_id: pair.rightId, outcome: "MERGE" as const, reason_code: "NAME_VARIANT_STRONG" as const, evidence_pages: [1], explanation: null })) });
    const store = memoryCheckpointStore();
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store };
    const rawEvidence = [{ chunkId: "chunk", pages: [{ pageNumber: 1, text: "The Chasm, also called Chasm, lies below." }], raw: { relationships: [{ source: "The Chasm", relationship: "also known as", target: "Chasm", page: 1, evidence_quote: "The Chasm, also called Chasm" }] } }];
    const first = await adjudicateDuplicateCandidates(inventory, candidates, rawEvidence, model, context);
    const replay = await adjudicateDuplicateCandidates(inventory, candidates, rawEvidence, model, context);
    expect(first.checkpointStatus).toBe("RUN");
    expect(replay.checkpointStatus).toBe("REUSE");
    expect(model.parseStructured).toHaveBeenCalledOnce();
    expect(model.parseStructured).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ candidate_pairs: [expect.objectContaining({ source_page_overlap: [1] })], relevant_first_pass_relationships: [expect.objectContaining({ relationship: "also known as" })], explicit_identity_alias_evidence: [expect.any(Object)] }) }));
    const identity = duplicateAdjudicationCheckpointIdentity(inventory, candidates, rawEvidence, model, context);
    const changed = duplicateAdjudicationCheckpointIdentity(inventory, candidates, [{ chunkId: "x", raw: { relationships: [] } }], model, context);
    expect(identity.upstreamFingerprint).not.toBe(changed.upstreamFingerprint);
  });

  it("makes zero model calls when there are no candidates", async () => {
    const inventory: GraphInventory = { entities: [entity("a", "Silver Guard", "faction"), entity("b", "Golden Guard", "faction")] };
    const candidates = buildDuplicateCandidates(inventory, []);
    const model = provider({ merge_groups: [], review_pairs: [], pair_decisions: [] });
    const result = await adjudicateDuplicateCandidates(inventory, candidates, [], model, { campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store: memoryCheckpointStore() });
    expect(result.checkpointStatus).toBe("REUSE");
    expect(model.parseStructured).not.toHaveBeenCalled();
  });
});

describe("bounded duplicate adjudication batches", () => {
  const usage = { model: "model", responseId: null, inputTokens: 1, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null };
  const inventory: GraphInventory = { entities: Array.from({ length: 53 }, (_, index) => entity(`entity-${index}`, `Entity ${index}`, "npc", index + 1)) };
  const pairs = Array.from({ length: 52 }, (_, index) => ({ leftId: `entity-${index}`, rightId: `entity-${index + 1}`, reasons: ["exact_name" as const] }));
  const candidates = { pairs, components: [{ componentId: "duplicate_component_1", memberIds: inventory.entities.map((item) => item.temporary_id), pairs }] };
  const context = () => ({ campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store: memoryCheckpointStore() });
  const model = () => {
    const parseStructured = vi.fn(async ({ payload }: { payload: { candidate_pairs: Array<{ left_id: string; right_id: string }> } }) => ({
      output: {
        merge_groups: [],
        review_pairs: [],
        pair_decisions: payload.candidate_pairs.map((pair) => ({ left_id: pair.left_id, right_id: pair.right_id, outcome: "MERGE" as const, reason_code: "NAME_VARIANT_STRONG" as const, evidence_pages: [1], explanation: null })),
      },
      providerId: "openai" as const,
      modelId: "model",
      responseId: null,
      usage,
    }));
    return { providerId: "openai" as const, modelId: "model", parseStructured } as unknown as StructuredModelProvider & { parseStructured: typeof parseStructured };
  };

  it("partitions every candidate pair once within deterministic pair and payload bounds", () => {
    const batches = buildDuplicateAdjudicationBatches(inventory, candidates, []);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.candidates.pairs.length <= MAX_DUPLICATE_ADJUDICATION_BATCH_PAIRS)).toBe(true);
    expect(batches.every((batch) => batch.payloadBytes <= MAX_DUPLICATE_ADJUDICATION_BATCH_PAYLOAD_BYTES)).toBe(true);
    const assigned = batches.flatMap((batch) => batch.candidates.pairs.map((pair) => [pair.leftId, pair.rightId].sort().join("|"))).sort();
    expect(assigned).toEqual(candidates.pairs.map((pair) => [pair.leftId, pair.rightId].sort().join("|")).sort());
    expect(new Set(assigned).size).toBe(candidates.pairs.length);
  });

  it("combines batch decisions into the same transitive merge semantics as one complete decision set", async () => {
    const store = memoryCheckpointStore();
    const provider = model();
    const result = await adjudicateDuplicateCandidates(inventory, candidates, [], provider, { campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store });
    const singleDecision = validateDuplicateAdjudication({ merge_groups: [], review_pairs: [], pair_decisions: candidates.pairs.map((pair) => ({ left_id: pair.leftId, right_id: pair.rightId, outcome: "MERGE", reason_code: "NAME_VARIANT_STRONG", evidence_pages: [1], explanation: null })) }, candidates, inventory);
    expect(result.batches).toHaveLength(buildDuplicateAdjudicationBatches(inventory, candidates, []).length);
    expect(provider.parseStructured).toHaveBeenCalledTimes(result.batches.length);
    expect(applyEntityMerges(inventory, result.decision).inventory).toEqual(applyEntityMerges(inventory, singleDecision).inventory);
  });

  it("plans, reuses, and retries checkpoints independently for each batch", async () => {
    const store = memoryCheckpointStore();
    const provider = model();
    const checkpointContext = { campaignId: "campaign", documentId: "document", processingMode: "lean", sourceIdentity: "source", store };
    const planned = await planDuplicateAdjudication(inventory, candidates, [], provider, checkpointContext);
    expect(planned).toHaveLength(buildDuplicateAdjudicationBatches(inventory, candidates, []).length);
    expect(planned.every((item) => item.status === "RUN")).toBe(true);
    const first = await adjudicateDuplicateCandidates(inventory, candidates, [], provider, checkpointContext);
    const replay = await adjudicateDuplicateCandidates(inventory, candidates, [], provider, checkpointContext);
    expect(replay.batches.every((item) => item.checkpointStatus === "REUSE")).toBe(true);
    const corrupted = [...store.validated.values()].find((item) => item.identity.operationKey === first.batches[1]!.identity.operationKey)!;
    corrupted.output = { decision: { merge_groups: [], review_pairs: [], pair_decisions: [] } };
    const retried = await adjudicateDuplicateCandidates(inventory, candidates, [], provider, checkpointContext);
    expect(retried.batches.filter((item) => item.checkpointStatus === "RUN")).toHaveLength(1);
    expect(provider.parseStructured).toHaveBeenCalledTimes(first.batches.length + 1);
    expect(store.failures).toHaveLength(1);
  });
});
