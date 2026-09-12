import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAICallBudget, OpenAICallBudgetExceededError, summarizePaidCallPlan, withOpenAICallBudget } from "@/lib/ai/openai-call-budget";
import { memoryCheckpointStore } from "@/lib/ai/operation-checkpoint";
import { reconcileGroupsWithAI } from "@/lib/ai/reconcile";
import type { StructuredModelProvider } from "@/lib/ai/structured-model-provider";

const usage = { model: "model-a", responseId: "response", inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null };

describe("v0.4 M5 paid-call guards", () => {
  it("reports reuse, invalidation, application retry headroom, and a preflight block", () => {
    const plan = summarizePaidCallPlan("openai", [{ status: "REUSE" }, { status: "RUN" }, { status: "INVALIDATED" }], 2, 3);
    expect(plan).toMatchObject({ reusedOperations: 1, invalidatedOperations: 1, plannedOpenAICalls: 2, plannedLocalCalls: 0, retryCeiling: 2, maximumApplicationOpenAIAttempts: 4, maximumAllowedOpenAIAttempts: 3, guardResult: "BLOCK" });
  });

  it("counts application-level OpenAI attempts before dispatch and excludes local calls", async () => {
    const openaiParse = vi.fn(async () => ({ output: { value: "ok" }, providerId: "openai" as const, modelId: "model-a", responseId: "r", usage }));
    const openai: StructuredModelProvider = { providerId: "openai", modelId: "model-a", parseStructured: openaiParse as never };
    const budget = new OpenAICallBudget(1);
    const guarded = withOpenAICallBudget(openai, budget);
    await guarded.parseStructured({ system: "test", payload: {}, schema: z.object({ value: z.string() }), schemaName: "test" });
    await expect(guarded.parseStructured({ system: "test", payload: {}, schema: z.object({ value: z.string() }), schemaName: "test" })).rejects.toBeInstanceOf(OpenAICallBudgetExceededError);
    expect(openaiParse).toHaveBeenCalledOnce();

    const localParse = vi.fn(async () => ({ output: { value: "ok" }, providerId: "local" as const, modelId: "local-a", responseId: "r", usage }));
    const local: StructuredModelProvider = { providerId: "local", modelId: "local-a", parseStructured: localParse as never };
    await withOpenAICallBudget(local, budget).parseStructured({ system: "test", payload: {}, schema: z.object({ value: z.string() }), schemaName: "test" });
    expect(budget.usedAttempts).toBe(1);
    expect(localParse).toHaveBeenCalledOnce();
  });

  it("does not fall back to OpenAI when a local provider is unavailable or rate-limited", async () => {
    const openaiParse = vi.fn();
    const localParse = vi.fn(async () => { throw new Error("Local AI request failed (429 Too Many Requests)"); });
    const local: StructuredModelProvider = { providerId: "local", modelId: "local-a", parseStructured: localParse as never };
    await expect(withOpenAICallBudget(local, new OpenAICallBudget(1)).parseStructured({ system: "test", payload: {}, schema: z.object({ value: z.string() }), schemaName: "test" })).rejects.toThrow("429");
    expect(localParse).toHaveBeenCalledOnce();
    expect(openaiParse).not.toHaveBeenCalled();
  });

  it("fails closed on corrupt reconciliation output, records failure, and reruns", async () => {
    const store = memoryCheckpointStore();
    const groups = ["a", "b"].map((id) => ({ id, type: "npc" as const, normalizedName: id, candidates: [{ id, name: id, normalizedName: id, type: "npc" as const, roles: [], aliases: [], summary: id, sources: [] }] }));
    const provider: StructuredModelProvider = { providerId: "openai", modelId: "model-a", parseStructured: vi.fn(async () => ({ output: { canonical_entities: groups.map((group) => ({ canonical_id: group.id, name: group.id, type: "npc", roles: [], aliases: [], summary: group.id, group_ids: [group.id], identity_evidence: [] })) }, providerId: "openai" as const, modelId: "model-a", responseId: "r", usage })) as never };
    await reconcileGroupsWithAI(groups as never, provider, { campaignId: "c", documentId: "d", sourceExtractionCacheId: "run", store });
    const checkpoint = [...store.validated.values()][0];
    checkpoint.output = { canonical_entities: [] };
    const resumed = await reconcileGroupsWithAI(groups as never, provider, { campaignId: "c", documentId: "d", sourceExtractionCacheId: "run", store });
    expect(resumed.checkpointStatus).toBe("RUN");
    expect(store.failures).toHaveLength(1);
    expect(provider.parseStructured).toHaveBeenCalledTimes(2);
  });
});
