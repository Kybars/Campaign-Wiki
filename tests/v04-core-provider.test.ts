import { extractChunk, extractChunksLimited } from "@/lib/ai/extract";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import type { DeterministicGroup } from "@/lib/graph/types";
import { describe, expect, it, vi } from "vitest";

const usage = (model = "local-stage-model") => ({ model, responseId: null, inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: null });
const provider = (parseStructured: unknown): StructuredModelProvider => ({ providerId: "local", modelId: "local-stage-model", parseStructured: parseStructured as StructuredModelProvider["parseStructured"] });
const chunk = { id: "chunk-1", characterCount: 17, pages: [{ pageNumber: 1, text: "Mira is a hunter." }] };
const extraction = { entities: [{ temporary_id: "mira", name: "Mira", type: "npc" as const, roles: [], aliases: [], summary: "A hunter.", sources: [{ page_number: 1, supporting_text: "Mira is a hunter." }], facts: [{ temporary_id: "job", field_key: "occupation" as const, content: "Hunter", sources: [{ page_number: 1, supporting_text: "Mira is a hunter." }] }] }], relationships: [] };

describe("provider-independent core stages", () => {
  it("extracts and provenance-validates a local structured result while retaining local usage identity", async () => {
    const parseStructured = vi.fn(async () => ({ output: extraction, providerId: "local" as const, modelId: "local-stage-model", responseId: null, usage: usage() }));
    const result = await extractChunk(chunk, provider(parseStructured));
    expect(result.extraction.entities[0].facts).toHaveLength(1);
    expect(result.rawExtraction).toEqual(extraction);
    expect(result.usage).toMatchObject({ model: "local-stage-model", inputTokens: null, estimatedCostUsd: null });
    expect(parseStructured).toHaveBeenCalledWith(expect.objectContaining({ system: expect.any(String), payload: expect.stringContaining("Mira is a hunter."), schemaName: "campaign_chunk_extraction" }));
  });

  it("preserves bounded multi-chunk concurrency and propagates local failures without fallback", async () => {
    let active = 0; let maximum = 0;
    const parseStructured = vi.fn(async () => {
      active += 1; maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { output: extraction, providerId: "local" as const, modelId: "local-stage-model", responseId: null, usage: usage() };
    });
    await extractChunksLimited([chunk, { ...chunk, id: "chunk-2" }, { ...chunk, id: "chunk-3" }], 2, undefined, provider(parseStructured));
    expect(maximum).toBe(2);
    const failure = provider(vi.fn().mockRejectedValue(new Error("local endpoint unavailable")));
    await expect(extractChunk(chunk, failure)).rejects.toThrow("local endpoint unavailable");
  });

  it("keeps source validation strict for local output", async () => {
    const invalidEvidence = { ...extraction, entities: [{ ...extraction.entities[0], sources: [{ page_number: 9, supporting_text: "Invented" }] }] };
    const result = await extractChunk(chunk, provider(vi.fn(async () => ({ output: invalidEvidence, providerId: "local" as const, modelId: "local-stage-model", responseId: null, usage: usage() }))));
    expect(result.extraction.entities).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("reconciles through the shared provider and rejects incomplete or duplicate group coverage", async () => {
    const candidate = (id: string, name: string) => ({ id, chunkId: "chunk", temporaryId: id, name, type: "npc" as const, roles: [], aliases: [], summary: `${name}.`, sources: [{ page_number: 1, supporting_text: `${name} appears.` }], facts: [] });
    const groups: DeterministicGroup[] = [{ id: "group-1", type: "npc", candidates: [candidate("a", "Mira")] }, { id: "group-2", type: "npc", candidates: [candidate("b", "Tomas")] }];
    const entity = (id: string, groupId: string, name: string) => ({ canonical_id: id, name, group_ids: [groupId], type: "npc" as const, roles: [], aliases: [], summary: `${name}.`, identity_evidence: [] });
    const valid = { canonical_entities: [entity("mira", "group-1", "Mira"), entity("tomas", "group-2", "Tomas")] };
    const parseStructured = vi.fn(async () => ({ output: valid, providerId: "local" as const, modelId: "local-stage-model", responseId: null, usage: usage() }));
    await expect(reconcileGroupsWithAI(groups, provider(parseStructured))).resolves.toMatchObject({ decision: valid, usage: { model: "local-stage-model" } });
    expect(parseStructured).toHaveBeenCalledWith(expect.objectContaining({ schemaName: "campaign_entity_reconciliation", payload: expect.stringContaining("Reconcile every candidate group") }));
    for (const output of [{ canonical_entities: [entity("mira", "group-1", "Mira")] }, { canonical_entities: [{ ...entity("both", "group-1", "Mira"), group_ids: ["group-1", "group-1", "group-2"] }] }]) {
      await expect(reconcileGroupsWithAI(groups, provider(vi.fn(async () => ({ output, providerId: "local" as const, modelId: "local-stage-model", responseId: null, usage: usage() }))))).rejects.toThrow(/coverage failed/);
    }
    await expect(reconcileGroupsWithAI(groups, provider(vi.fn().mockRejectedValue(new Error("local reconciliation unavailable"))))).rejects.toThrow("local reconciliation unavailable");
  });
});
