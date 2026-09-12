import { describe, expect, it, vi } from "vitest";
import { extractChunksLimited } from "@/lib/ai/extract";
import { enrichCanonicalGraphWithAI, planEnrichmentResume } from "@/lib/ai/enrich";
import { memoryCheckpointStore, modelInputHash, semanticInputHash, stableSerialize, type AIOperationIdentity } from "@/lib/ai/operation-checkpoint";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import { enrichmentFixtureGraph } from "@/fixtures/enrichment-cache";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";
import { readFileSync } from "node:fs";

const usage = { model: "model-a", responseId: "response", inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2, totalTokens: 12, estimatedCostUsd: null };
const provider = (parseStructured: StructuredModelProvider["parseStructured"], modelId = "model-a"): StructuredModelProvider => ({ providerId: "openai", modelId, parseStructured });

describe("v0.4 M4 checkpoint identity", () => {
  it("hashes semantic objects deterministically without an external dependency", () => {
    expect(stableSerialize({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(semanticInputHash({ b: 2, a: 1 })).toBe(semanticInputHash({ a: 1, b: 2 }));
    expect(modelInputHash("prompt", { value: 1 })).not.toBe(modelInputHash("prompt", { value: 2 }));
  });

  it("reuses only an exact compatibility identity", async () => {
    const store = memoryCheckpointStore();
    const identity: AIOperationIdentity = { campaignId: "c", documentId: "d", sourceExtractionCacheId: null, providerId: "openai", modelId: "a", processingMode: "full", stage: "enrichment", operationType: "fact_visibility", operationKey: "0", inputHash: "a".repeat(64), upstreamFingerprint: "graph", behaviorVersion: "p1", schemaVersion: 1 };
    await store.saveValidated({ identity, output: { ok: true }, usage: [usage], attemptCount: 1 });
    await expect(store.inspect!(identity)).resolves.toMatchObject({ status: "REUSE" });
    for (const changed of [
      { providerId: "local" }, { modelId: "b" }, { behaviorVersion: "p2" }, { schemaVersion: 2 },
      { inputHash: "b".repeat(64) }, { upstreamFingerprint: "other" },
    ]) await expect(store.inspect!({ ...identity, ...changed })).resolves.toMatchObject({ status: "INVALIDATED" });
    await expect(store.inspect!({ ...identity, operationKey: "1" })).resolves.toMatchObject({ status: "RUN" });
  });

  it("defines a private service-role-only checkpoint migration", () => {
    const migration = readFileSync("supabase/migrations/20260911120000_v04_m4_ai_operation_checkpoints.sql", "utf8");
    expect(migration).toContain("create table public.ai_operation_checkpoints");
    expect(migration).toContain("alter table public.ai_operation_checkpoints enable row level security");
    expect(migration).toContain("grant select, insert, update, delete on table public.ai_operation_checkpoints to service_role");
    expect(migration).toContain("revoke all privileges on table public.ai_operation_checkpoints from anon, authenticated");
    expect(migration).not.toMatch(/create policy/i);
  });
});

describe("v0.4 M4 interruption durability", () => {
  it("reuses validated extraction chunks from an interrupted run", async () => {
    const store = memoryCheckpointStore();
    const chunks = [0, 1, 2].map((index) => ({ id: `chunk-${index}`, pages: [{ pageNumber: index + 1, text: `Page ${index + 1}` }], characterCount: 6 }));
    const parse = vi.fn(async ({ payload }: { payload: unknown }) => {
      if (JSON.stringify(payload).includes("Page 3")) throw new Error("interrupted");
      return { output: { entities: [], relationships: [] }, providerId: "openai" as const, modelId: "model-a", responseId: "r", usage };
    });
    await expect(extractChunksLimited(chunks, 1, undefined, provider(parse as never), { campaignId: "c", documentId: "d", processingMode: "lean", store })).rejects.toThrow("interrupted");
    parse.mockImplementation(async () => ({ output: { entities: [], relationships: [] }, providerId: "openai" as const, modelId: "model-a", responseId: "r", usage }));
    parse.mockClear();
    const resumed = await extractChunksLimited(chunks, 1, undefined, provider(parse as never), { campaignId: "c", documentId: "d", processingMode: "lean", store });
    expect(resumed.map((item) => item.checkpointStatus)).toEqual(["REUSE", "REUSE", "RUN"]);
    expect(parse).toHaveBeenCalledOnce();
  });

  it("reuses validated reconciliation after downstream persistence fails", async () => {
    const store = memoryCheckpointStore();
    const groups = ["a", "b"].map((id) => ({ id, type: "npc" as const, normalizedName: id, candidates: [{ id, name: id, normalizedName: id, type: "npc" as const, roles: [], aliases: [], summary: id, sources: [] }] }));
    const output = { canonical_entities: groups.map((group) => ({ canonical_id: `canonical-${group.id}`, name: group.id, type: "npc" as const, roles: [], aliases: [], summary: group.id, group_ids: [group.id], identity_evidence: [] })) };
    const parse = vi.fn(async () => ({ output, providerId: "openai" as const, modelId: "model-a", responseId: "r", usage }));
    const context = { campaignId: "c", documentId: "d", sourceExtractionCacheId: "run", store };
    const first = await reconcileGroupsWithAI(groups as never, provider(parse as never), context);
    expect(first.checkpointStatus).toBe("RUN");
    // A downstream transaction can fail here; the validated decision is already durable.
    const resumed = await reconcileGroupsWithAI(groups as never, provider(parse as never), context);
    expect(resumed).toMatchObject({ checkpointStatus: "REUSE", usage: undefined });
    expect(parse).toHaveBeenCalledOnce();
  });

  it("reuses completed enrichment operations after a mid-stage interruption", async () => {
    const graph = enrichmentFixtureGraph();
    const template = graph.facts[0];
    graph.facts = Array.from({ length: 201 }, (_, index) => ({ ...template, stableKey: `fact-${index}`, content: `Fact ${index}` }));
    const store = memoryCheckpointStore();
    let fail = true;
    const parse = vi.fn(async (system: string, payload: unknown, _schema: unknown, name: string) => {
      if (fail && name.startsWith("fact_visibility_2_")) throw new Error("interrupted");
      const record = payload as { facts?: Array<{ key: string }>; relationships?: Array<{ key: string }> };
      let output: unknown;
      if (name.startsWith("entity_classification")) output = { entities: graph.entities.map((entity) => ({ entity_key: entity.key, prominence: "minor", prominence_reason: "fixture", prominence_evidence_ids: [], visibility: "dm_only" })) };
      else if (name.startsWith("fact_visibility")) output = { facts: record.facts!.map((fact) => ({ fact_key: fact.key, visibility: "dm_only" })) };
      else if (name.startsWith("relationship_visibility")) output = { relationships: record.relationships!.map((relationship) => ({ relationship_key: relationship.key, visibility: "dm_only" })) };
      else if (name.startsWith("gm_entity_summaries")) output = { summaries: (payload as Array<{ key: string }>).map((entity) => ({ entity_key: entity.key, summary: null, evidence_ids: [] })) };
      else if (name.startsWith("player_entity_summaries")) output = { summaries: [] };
      else output = { overview: null, evidence_ids: [] };
      return { output, usage };
    });
    const context = { campaignId: "c", documentId: "d", sourceExtractionCacheId: "run", processingMode: "full" as const, providerId: "openai", modelId: "model-a", graphFingerprint: "graph" };
    await expect(enrichCanonicalGraphWithAI(graph, { parse: parse as never, checkpointStore: store, checkpointContext: context })).rejects.toThrow("interrupted");
    fail = false; parse.mockClear();
    const resumed = await enrichCanonicalGraphWithAI(graph, { parse: parse as never, checkpointStore: store, checkpointContext: context });
    expect(resumed.checkpointReport.slice(0, 2).map((item) => item.status)).toEqual(["REUSE", "REUSE"]);
    expect(resumed.checkpointReport.some((item) => item.operationType === "fact_visibility" && item.operationKey === "1" && item.status === "RUN")).toBe(true);
    expect(resumed.usage.length).toBeLessThan(resumed.checkpointReport.length);
    const sizeBeforePlan = store.validated.size;
    const plan = await planEnrichmentResume(graph, store, context);
    expect(plan.every((item) => item.status === "REUSE")).toBe(true);
    expect(store.validated.size).toBe(sizeBeforePlan);
    expect(parse).toHaveBeenCalledTimes(resumed.usage.length);
  });
});
