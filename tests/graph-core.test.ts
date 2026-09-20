import { describe, expect, it, vi } from "vitest";
import { buildFinalGraphInventory, buildLeanGraphCore, graphCompletenessCheckpointIdentity, graphExtractionCheckpointIdentity, runGraphChunk } from "@/lib/processing/graph-core";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";

const chunk = { id: "chunk-1", characterCount: 100, pages: [{ pageNumber: 1, text: "Mira owns the Sword. The Sword is in the Vault." }] };
const source = { page_number: 1, supporting_text: "Mira owns the Sword." };
const inventory = buildFinalGraphInventory([{ entities: [
  { temporary_id: "mira", name: "Mira", type: "npc", sources: [source] },
  { temporary_id: "sword", name: "Sword", type: "item", sources: [{ page_number: 1, supporting_text: "Mira owns the Sword." }] },
  { temporary_id: "vault", name: "Vault", type: "location", sources: [{ page_number: 1, supporting_text: "The Sword is in the Vault." }] },
] }]);

function provider(modelId: string, outputs: unknown[]) {
  const parseStructured = vi.fn(async () => ({ output: outputs.shift(), providerId: "openai" as const, modelId, responseId: null, usage: { model: modelId, responseId: null, inputTokens: 1, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null } }));
  return { providerId: "openai" as const, modelId, parseStructured } as unknown as StructuredModelProvider & { parseStructured: typeof parseStructured };
}

describe("graph core production adapter", () => {
  it("preserves the evidence-backed instance direction, page-derived provenance, and no generated facts", () => {
    const mira = inventory.entities.find((entity) => entity.name === "Mira")!;
    const sword = inventory.entities.find((entity) => entity.name === "Sword")!;
    const vault = inventory.entities.find((entity) => entity.name === "Vault")!;
    const result = buildLeanGraphCore(inventory, [chunk], [{ chunkId: chunk.id, firstPass: [], completeness: [], firstPassUsage: null, completenessUsage: null, firstPassCheckpointStatus: "REUSE", completenessCheckpointStatus: "REUSE", relationships: [{ sourceInventoryId: vault.temporary_id, targetInventoryId: sword.temporary_id, sourceName: "Vault", targetName: "Sword", relationship: "contains", relationshipType: "located in", forwardLabel: "located in", inverseLabel: "contains", page: 1, semanticKey: `${sword.temporary_id}|${vault.temporary_id}|location_containment`, knownInverse: true, evidenceQuote: "The Sword is in the Vault.", matchedEvidenceText: "The Sword is in the Vault." }] }]);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({ sourceEntityKey: vault.temporary_id, targetEntityKey: sword.temporary_id, relationshipType: "contains" });
    expect(result.relationships[0].sources[0].supporting_text).toContain("Sword is in the Vault");
    expect(result.facts).toEqual([]);
    expect(result.entities.map((entity) => entity.summary)).toEqual(["", "", ""]);
    expect(mira.name).toBe("Mira");
  });

  it("reuses first pass and completeness checkpoints, while a completeness model change invalidates only completeness", async () => {
    const store = memoryCheckpointStore();
    const extraction = provider("first", [{ relationships: [{ source: "Mira", relationship: "owns", target: "Sword", page: 1, evidence_quote: "Mira owns the Sword." }] }]);
    const completeness = provider("second", [{ relationships: [{ source: "Vault", relationship: "contains", target: "Sword", page: 1, evidence_quote: "The Sword is in the Vault." }] }]);
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", store, finalInventoryFingerprint: "inventory", finalInventoryUpstreamFingerprint: "pass-a" };
    const first = await runGraphChunk(chunk, inventory, { extraction, completeness }, context);
    const reused = await runGraphChunk(chunk, inventory, { extraction, completeness }, context);
    expect(first.relationships).toHaveLength(2);
    expect(reused.firstPassCheckpointStatus).toBe("REUSE");
    expect(reused.completenessCheckpointStatus).toBe("REUSE");
    expect(extraction.parseStructured).toHaveBeenCalledTimes(1);
    expect(completeness.parseStructured).toHaveBeenCalledTimes(1);
    const changedCompleteness = provider("second-v2", [{ relationships: [] }]);
    const changed = await runGraphChunk(chunk, inventory, { extraction, completeness: changedCompleteness }, context);
    expect(changed.firstPassCheckpointStatus).toBe("REUSE");
    expect(changed.completenessCheckpointStatus).toBe("RUN");
    expect(extraction.parseStructured).toHaveBeenCalledTimes(1);
    expect(changedCompleteness.parseStructured).toHaveBeenCalledTimes(1);
  });

  it("makes graph checkpoint identities depend on final inventory and the first-pass canonical graph", () => {
    const store = memoryCheckpointStore();
    const context = { campaignId: "campaign", documentId: "document", processingMode: "lean", store, finalInventoryFingerprint: "a", finalInventoryUpstreamFingerprint: "pass-a" };
    const extraction = provider("first", []);
    const completeness = provider("second", []);
    const first = graphExtractionCheckpointIdentity(chunk, inventory, extraction, context);
    const changedInventory = graphExtractionCheckpointIdentity(chunk, inventory, extraction, { ...context, finalInventoryFingerprint: "b" });
    expect(first.upstreamFingerprint).not.toBe(changedInventory.upstreamFingerprint);
    const edge = { sourceInventoryId: inventory.entities[0].temporary_id, targetInventoryId: inventory.entities[1].temporary_id, sourceName: "Mira", targetName: "Sword", relationship: "owns", relationshipType: "owns", forwardLabel: "owns", inverseLabel: "owned by", page: 1, semanticKey: `${inventory.entities[0].temporary_id}|${inventory.entities[1].temporary_id}|ownership`, knownInverse: true, evidenceQuote: "Mira owns the Sword.", matchedEvidenceText: "Mira owns the Sword." };
    const complete = graphCompletenessCheckpointIdentity(chunk, inventory, [edge], completeness, context);
    const changedFirst = graphCompletenessCheckpointIdentity(chunk, inventory, [], completeness, context);
    expect(complete.upstreamFingerprint).not.toBe(changedFirst.upstreamFingerprint);
    const unchanged = graphCompletenessCheckpointIdentity(chunk, inventory, [edge], completeness, context);
    expect(complete).toEqual(unchanged);
    const reconciledInventory = { entities: inventory.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["Lady Mira"] } : entity) };
    const changedMerge = graphCompletenessCheckpointIdentity(chunk, reconciledInventory, [edge], completeness, { ...context, finalInventoryFingerprint: "merged-b" });
    expect(complete.upstreamFingerprint).not.toBe(changedMerge.upstreamFingerprint);
  });
});
