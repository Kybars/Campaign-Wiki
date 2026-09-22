import { describe, expect, it, vi } from "vitest";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import { OpenAICallBudget } from "@/lib/ai/openai-call-budget";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { buildLeanGraphCore } from "@/lib/processing/graph-core";
import { buildGraphCoverageAudit, buildRelationshipRescueBatches, buildRelationshipRescueInput, COVERAGE_THRESHOLDS, planRelationshipRescue, runRelationshipRescueBatch, validateRelationshipRescue } from "@/lib/processing/relationship-rescue";

const pages = [
  { pageNumber: 1, text: "General Magdus will join the Ragesian Navy when it begins a blockade of Turinn, the capital city of Sindaire." },
  { pageNumber: 2, text: "Turinn, capital of Sindaire, is under naval blockade by the Ragesian Navy and under attack by Ostalin." },
  { pageNumber: 3, text: "A minor Coin lies forgotten." },
];
const inventory: GraphInventory = { entities: [
  ["turinn", "Turinn", "location"], ["sindaire", "Sindaire", "location"], ["magdus", "General Magdus", "npc"],
  ["navy", "Ragesian Navy", "faction"], ["ostalin", "Ostalin", "faction"], ["coin", "Coin", "item"],
].map(([temporary_id, name, type]) => ({ temporary_id, name, type: type as never, aliases: [], memberIds: [temporary_id], sources: [{ page_number: name === "Coin" ? 3 : 1, supporting_text: `${name} appears.` }] })) };
const chunks = pages.map((page) => ({ id: `page-${page.pageNumber}`, pages: [page], characterCount: page.text.length }));
const emptyGraph = buildLeanGraphCore(inventory, chunks, chunks.map((chunk) => ({ chunkId: chunk.id, firstPass: [], completeness: [], relationships: [], firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE" as const, completenessCheckpointStatus: "REUSE" as const })));
const usage = { model: "model", responseId: "response", inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null };
const coverageItem = (entity_id: string, canonical_name: string) => ({ entity_id, canonical_name, type: "location", aliases: [], mention_count: 2, mention_page_count: 2, relationship_degree: 0, relationship_evidence_page_count: 0, source_occurrence_excerpt_count: 2, nearby_known_entity_count: 1, nearby_known_entity_ids: ["sindaire"], occurrence_excerpts: [{ page: 1, excerpt: `${canonical_name} appears.`, nearby_entity_ids: ["sindaire"] }, { page: 2, excerpt: `${canonical_name} returns.`, nearby_entity_ids: ["sindaire"] }], flags: ["SUSPICIOUS_ZERO_RELATIONSHIPS" as const] });

describe("deterministic relationship coverage and rescue", () => {
  it("flags repeated, connected-context zero-degree entities while leaving a one-off minor item sparse-ok", () => {
    const coverage = buildGraphCoverageAudit(emptyGraph, pages);
    const turinn = coverage.find((item) => item.entity_id === "turinn")!;
    expect(turinn).toMatchObject({ mention_count: 2, mention_page_count: 2, relationship_degree: 0, relationship_evidence_page_count: 0, source_occurrence_excerpt_count: 2 });
    expect(turinn.nearby_known_entity_count).toBeGreaterThanOrEqual(4);
    expect(turinn.flags).toEqual(["SUSPICIOUS_ZERO_RELATIONSHIPS"]);
    expect(coverage.find((item) => item.entity_id === "coin")?.flags).toEqual(["SPARSE_OK"]);
    expect(COVERAGE_THRESHOLDS.maximumTargetsPerBatch).toBe(12);
  });

  it("does not rescue a singleton merely because one busy page has many nearby entities", () => {
    const busyPage = { pageNumber: 9, text: "Lone Token lies beside Turinn, Sindaire, General Magdus, the Ragesian Navy, and Ostalin." };
    const busyInventory: GraphInventory = { entities: [...inventory.entities, { temporary_id: "lone", name: "Lone Token", type: "item", aliases: [], memberIds: ["lone"], sources: [{ page_number: 9, supporting_text: "Lone Token lies beside Turinn." }] }] };
    const busyChunk = { id: "busy", pages: [busyPage], characterCount: busyPage.text.length };
    const graph = buildLeanGraphCore(busyInventory, [busyChunk], [{ chunkId: "busy", firstPass: [], completeness: [], relationships: [], firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE" }]);
    const coverage = buildGraphCoverageAudit(graph, [busyPage]);
    expect(coverage.find((item) => item.entity_id === "lone")?.flags).toEqual(["SPARSE_OK"]);
    expect(buildRelationshipRescueBatches(coverage, graph, [busyPage]).some((batch) => batch.targets.some((target) => target.entity_id === "lone"))).toBe(false);
  });

  it("scales gap-call planning with suspicious windows while covering every bounded target", () => {
    const metric = (index: number) => ({ entity_id: `entity-${index}`, canonical_name: `Entity ${index}`, type: "npc", aliases: [], mention_count: 2, mention_page_count: 2, relationship_degree: 0, relationship_evidence_page_count: 0, source_occurrence_excerpt_count: 2, nearby_known_entity_count: 2, nearby_known_entity_ids: ["turinn"], occurrence_excerpts: [{ page: 1, excerpt: `Entity ${index} appears.`, nearby_entity_ids: ["turinn"] }, { page: 2, excerpt: `Entity ${index} returns.`, nearby_entity_ids: ["turinn"] }], flags: ["SUSPICIOUS_ZERO_RELATIONSHIPS" as const] });
    const small = buildRelationshipRescueBatches(Array.from({ length: 4 }, (_, index) => metric(index)), emptyGraph, pages);
    const large = buildRelationshipRescueBatches(Array.from({ length: 200 }, (_, index) => metric(index)), emptyGraph, pages);
    expect(small).toHaveLength(1);
    expect(large).toHaveLength(Math.ceil(200 / COVERAGE_THRESHOLDS.maximumTargetsPerBatch));
    expect(large[0].targets.length).toBeLessThanOrEqual(COVERAGE_THRESHOLDS.maximumTargetsPerBatch);
    expect(large.flatMap((batch) => batch.targets).map((target) => target.entity_id).sort()).toEqual(Array.from({ length: 200 }, (_, index) => `entity-${index}`).sort());
  });

  it("does not drop Turinn-style multi-page zero-degree targets when a window exceeds its target cap", () => {
    const target = coverageItem("turinn", "Turinn");
    const crowded = [...Array.from({ length: COVERAGE_THRESHOLDS.maximumTargetsPerBatch }, (_, index) => coverageItem(`a-${index}`, `Crowd ${index}`)), target];
    const batches = buildRelationshipRescueBatches(crowded, emptyGraph, pages);
    const turinn = batches.flatMap((batch) => batch.targets).find((item) => item.entity_id === "turinn");
    expect(turinn?.occurrence_excerpts.map((excerpt) => excerpt.page)).toEqual([1, 2]);
    expect(batches.flatMap((batch) => batch.targets)).toHaveLength(crowded.length);
  });

  it("batches targets sharing pages into a bounded focused evidence pack", () => {
    const coverage = buildGraphCoverageAudit(emptyGraph, pages);
    const batches = buildRelationshipRescueBatches(coverage, emptyGraph, pages);
    const turinnBatch = batches.find((batch) => batch.targets.some((target) => target.entity_id === "turinn"))!;
    const input = buildRelationshipRescueInput(turinnBatch);
    expect(turinnBatch.targets.length).toBeLessThanOrEqual(COVERAGE_THRESHOLDS.maximumTargetsPerBatch);
    expect(turinnBatch.pages.length).toBeLessThanOrEqual(COVERAGE_THRESHOLDS.maximumPagesPerBatch);
    expect(input.relevant_known_entities.length).toBeLessThanOrEqual(COVERAGE_THRESHOLDS.maximumRelevantEntitiesPerBatch);
    expect(input.relevant_known_entities.length).toBeLessThan(inventory.entities.length);
    expect(input.source_evidence.every((item) => [1, 2].includes(item.page))).toBe(true);
  });

  it("accepts exact supported target relationships and rejects unsupported or off-target proposals through the shared validator", () => {
    const coverage = buildGraphCoverageAudit(emptyGraph, pages);
    const groupedBatch = buildRelationshipRescueBatches(coverage, emptyGraph, pages).find((item) => item.targets.some((target) => target.entity_id === "turinn"))!;
    const batch = { ...groupedBatch, targets: groupedBatch.targets.filter((target) => target.entity_id === "turinn") };
    const raw = { relationships: [
      { source: "Turinn", relationship: "capital of", target: "Sindaire", page: 2, evidence_quote: "Turinn, capital of Sindaire" },
      { source: "Ragesian Navy", relationship: "blockades", target: "Turinn", page: 2, evidence_quote: "under naval blockade by the Ragesian Navy" },
      { source: "Ostalin", relationship: "attacks", target: "Turinn", page: 2, evidence_quote: "under attack by Ostalin" },
      { source: "General Magdus", relationship: "commands", target: "Ragesian Navy", page: 2, evidence_quote: "General Magdus commands the Ragesian Navy" },
      { source: "General Magdus", relationship: "joins", target: "Ragesian Navy", page: 1, evidence_quote: "General Magdus will join the Ragesian Navy" },
    ] };
    const validation = validateRelationshipRescue(raw, inventory, batch);
    expect(validation.relationships.map((item) => item.relationship)).toEqual(expect.arrayContaining(["capital of", "blockades", "attacks"]));
    expect(validation.validationRecords.map((item) => item.outcome)).toEqual(expect.arrayContaining(["REJECTED_EVIDENCE_NOT_FOUND", "REJECTED_TARGET_NOT_ENDPOINT"]));
    expect(validation.relationships.every((item) => item.matchedEvidenceText.length > 0)).toBe(true);
    const rescueGraph = buildLeanGraphCore(inventory, [{ id: batch.batchId, pages: batch.pages, characterCount: batch.pages.reduce((count, page) => count + page.text.length, 0) }], [{ chunkId: batch.batchId, firstPass: validation.relationships, completeness: [], relationships: validation.relationships, firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "RUN", completenessCheckpointStatus: "REUSE" }]);
    expect(rescueGraph.relationships).toHaveLength(3);
    expect(rescueGraph.relationships.map((item) => item.relationshipType)).toEqual(expect.arrayContaining(["capital of", "blockades", "attacks"]));
    expect(buildGraphCoverageAudit(rescueGraph, pages).find((item) => item.entity_id === "turinn")).toMatchObject({ relationship_degree: 3, flags: ["SPARSE_OK"] });
  });

  it("checkpoints each rescue batch and exposes reusable plans without repeating empty or successful attempts", async () => {
    const batch = buildRelationshipRescueBatches(buildGraphCoverageAudit(emptyGraph, pages), emptyGraph, pages)[0];
    const store = memoryCheckpointStore();
    const raw = { relationships: [{ source: "Turinn", relationship: "capital of", target: "Sindaire", page: 2, evidence_quote: "Turinn, capital of Sindaire" }] };
    const parseStructured = vi.fn(async () => ({ output: raw, providerId: "openai" as const, modelId: "model", responseId: "response", usage }));
    const provider: StructuredModelProvider = { providerId: "openai", modelId: "model", parseStructured: parseStructured as never };
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", store, upstreamFingerprint: "coverage-and-graph" };
    expect((await planRelationshipRescue([batch], provider, context))[0].status).toBe("RUN");
    const first = await runRelationshipRescueBatch(batch, inventory, provider, context);
    const second = await runRelationshipRescueBatch(batch, inventory, provider, context);
    expect(first.checkpointStatus).toBe("RUN");
    expect(second.checkpointStatus).toBe("REUSE");
    expect(parseStructured).toHaveBeenCalledOnce();
    expect((await planRelationshipRescue([batch], provider, context))[0].status).toBe("REUSE");
  });

  it("makes the complete rescue plan available for a pre-dispatch paid-call budget check", async () => {
    const batches = buildRelationshipRescueBatches(buildGraphCoverageAudit(emptyGraph, pages), emptyGraph, pages);
    expect(batches).toHaveLength(1);
    const provider = { providerId: "openai" as const, modelId: "model", parseStructured: vi.fn() as never };
    const plan = await planRelationshipRescue(batches, provider, { campaignId: "campaign", documentId: "document", processingMode: "lean", store: memoryCheckpointStore(), upstreamFingerprint: "coverage-and-graph" });
    const plannedPaidCalls = plan.filter((item) => item.status !== "REUSE").length;
    expect(new OpenAICallBudget(plannedPaidCalls - 1).allowPlanned(plannedPaidCalls)).toBe(false);
  });
});
