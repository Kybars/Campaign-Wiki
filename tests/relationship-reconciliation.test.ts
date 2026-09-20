import { describe, expect, it, vi } from "vitest";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { buildRelationshipInstances, planRelationshipReconciliation, runRelationshipReconciliation, validateRelationshipReconciliation } from "@/lib/ai/relationship-reconciliation";
import { resolveRawRelationships } from "@/lib/ai/graph-extraction";
import { buildLeanGraphCore, type GraphChunkResult } from "@/lib/processing/graph-core";

const page = { pageNumber: 1, text: "Mira keeps watch over the Ember Key. The Ember Key is watched over by Mira. Mira won the Ember Key in the tourney. Mira owns the Ember Key." };
const chunk = { id: "chunk", pages: [page], characterCount: page.text.length };
const inventory = { entities: [
  { temporary_id: "mira", name: "Mira", type: "npc" as const, aliases: [], sources: [{ page_number: 1, supporting_text: "Mira keeps watch." }] },
  { temporary_id: "key", name: "Ember Key", type: "item" as const, aliases: [], sources: [{ page_number: 1, supporting_text: "The Ember Key appears." }] },
] };
const raw = { relationships: [
  { source: "Mira", relationship: "keeps watch over", target: "Ember Key", page: 1, evidence_quote: "Mira keeps watch over the Ember Key." },
  { source: "Ember Key", relationship: "is watched over by", target: "Mira", page: 1, evidence_quote: "The Ember Key is watched over by Mira." },
  { source: "Mira", relationship: "won in the tourney", target: "Ember Key", page: 1, evidence_quote: "Mira won the Ember Key in the tourney." },
  { source: "Mira", relationship: "owns", target: "Ember Key", page: 1, evidence_quote: "Mira owns the Ember Key." },
] };

function graphInput(): GraphChunkResult[] {
  const relationships = resolveRawRelationships(raw, inventory, chunk).relationships;
  return [{ chunkId: chunk.id, rawFirstPass: raw, firstPass: relationships, completeness: [], relationships, firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE" }];
}

describe("evidence-aware relationship reconciliation", () => {
  it("reconciles arbitrary opposite-direction phrases from model decisions while preserving distinct facts", async () => {
    const inputs = graphInput();
    const instances = buildRelationshipInstances(inputs);
    const output = { groups: [
      { instance_ids: [instances[0].id, instances[1].id], canonical_instance_id: instances[0].id },
      { instance_ids: [instances[2].id], canonical_instance_id: instances[2].id },
      { instance_ids: [instances[3].id], canonical_instance_id: instances[3].id },
    ] };
    const parseStructured = vi.fn(async () => ({ output, providerId: "openai" as const, modelId: "model", responseId: null, usage: { model: "model", responseId: null, inputTokens: 1, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null } }));
    const provider = { providerId: "openai" as const, modelId: "model", parseStructured: parseStructured as never } satisfies StructuredModelProvider;
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", store: memoryCheckpointStore(), upstreamFingerprint: "instances" };
    expect(await planRelationshipReconciliation(instances, provider, context)).toHaveLength(1);
    const reconciliation = await runRelationshipReconciliation(instances, provider, context, 2);
    const graph = buildLeanGraphCore(inventory, [chunk], inputs, reconciliation);
    expect(parseStructured).toHaveBeenCalledOnce();
    expect(graph.relationships).toHaveLength(3);
    expect(graph.relationships.find((item) => item.relationshipType === "keeps watch over")?.sources).toHaveLength(2);
    expect(graph.relationships.map((item) => item.relationshipType)).toEqual(expect.arrayContaining(["won in the tourney", "owns"]));
    expect(graph.relationships.every((item) => item.normalization.forwardLabel === item.normalization.inverseLabel)).toBe(true);
  });

  it("rejects omissions, duplicate assignment, invented IDs, and unsupported canonicals", () => {
    const instances = buildRelationshipInstances(graphInput());
    expect(() => validateRelationshipReconciliation({ groups: [{ instance_ids: [instances[0].id], canonical_instance_id: instances[0].id }] }, "key|mira", instances)).toThrow(/omitted/);
    expect(() => validateRelationshipReconciliation({ groups: [{ instance_ids: instances.map((item) => item.id), canonical_instance_id: "invented" }] }, "key|mira", instances)).toThrow(/outside/);
    expect(() => validateRelationshipReconciliation({ groups: [{ instance_ids: [...instances.map((item) => item.id), "invented"], canonical_instance_id: instances[0].id }] }, "key|mira", instances)).toThrow(/invented/);
    expect(() => validateRelationshipReconciliation({ groups: [{ instance_ids: [instances[0].id, instances[0].id], canonical_instance_id: instances[0].id }] }, "key|mira", instances)).toThrow(/repeated/);
  });

  it("skips semantic model calls for singleton endpoint pairs", async () => {
    const instance = buildRelationshipInstances(graphInput()).slice(0, 1);
    const parseStructured = vi.fn();
    const provider = { providerId: "openai" as const, modelId: "model", parseStructured: parseStructured as never } satisfies StructuredModelProvider;
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", store: memoryCheckpointStore(), upstreamFingerprint: "singleton" };
    expect(await planRelationshipReconciliation(instance, provider, context)).toEqual([]);
    const result = await runRelationshipReconciliation(instance, provider, context, 1);
    expect(result[0].checkpointStatus).toBe("SKIP");
    expect(parseStructured).not.toHaveBeenCalled();
  });
});
